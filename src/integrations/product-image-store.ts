import { GetObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { Logger } from "pino";
import { codes, INTERNAL_SEVER_ERROR, type BusinessError } from "../contracts/business-error.ts";
import type { EnvVars } from "../infra/config.env.ts";
import { now } from "../utils/now.ts";
import { err, ok, type Result } from "../utils/result.ts";

const WEBP_CONTENT_TYPE = "image/webp";
const WEBP_SIGNATURE_LENGTH = 12;
const MAX_PRODUCT_IMAGE_BYTE_SIZE = 5 * 1024 * 1024;
const UPLOAD_TTL_SECONDS = 10 * 60;
const UPLOAD_PREFIX = "product-images/uploads/";
const VERIFIED_PREFIX = "product-images/verified/";

type ProductImageUpload = {
  uploadUrl: string;
  expiresAt: Date;
  headers: {
    "content-type": string;
    "content-length": string;
  };
};

type VerifiedProductImage = {
  storageKey: string;
  publicUrl: string;
};

type InjectedDependencies = {
  env: EnvVars;
  logger: Logger;
};

function productImageUploadKey(merchantId: string, productId: string, imageId: string): string {
  return `${UPLOAD_PREFIX}${merchantId}/${productId}/${imageId}.webp`;
}

function invalidImage(message: string) {
  return err({ code: codes.validationError, message, details: [] });
}

class ProductImageStore {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBaseUrl: string;
  private readonly managedUrls: Array<URL>;
  private readonly logger: Logger;

  constructor({ env, logger }: InjectedDependencies) {
    this.bucket = env.BUCKET_STORAGE_BUCKET_NAME;
    this.publicBaseUrl = `${env.BUCKET_STORAGE_PUBLIC_BASE_URL.replace(/\/+$/, "")}/${this.bucket}`;
    this.logger = logger.child({ component: this.constructor.name });
    const endpoint = new URL(env.BUCKET_STORAGE_ENDPOINT);
    const path = endpoint.pathname.replace(/\/+$/, "");
    const pathStyle = new URL(endpoint);
    pathStyle.pathname = `${path}/${this.bucket}`;
    const virtualHostStyle = new URL(endpoint);
    virtualHostStyle.hostname = `${this.bucket}.${endpoint.hostname}`;
    this.managedUrls = [new URL(this.publicBaseUrl), pathStyle];
    if (virtualHostStyle.hostname !== endpoint.hostname) {
      this.managedUrls.push(virtualHostStyle);
    }

    this.client = new S3Client({
      endpoint: endpoint.href,
      region: env.BUCKET_STORAGE_REGION,
      forcePathStyle: env.BUCKET_STORAGE_FORCE_PATH_STYLE,
      requestChecksumCalculation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: env.BUCKET_STORAGE_ACCESS_KEY_ID,
        secretAccessKey: env.BUCKET_STORAGE_SECRET_ACCESS_KEY,
      },
    });
  }

  isManagedUrl(value: string): boolean {
    if (!URL.canParse(value)) {
      return false;
    }
    const candidate = new URL(value);
    const candidatePath = candidate.pathname.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    );
    return this.managedUrls.some((base) => {
      const basePath = base.pathname.replace(/\/+$/, "");
      return (
        candidate.origin === base.origin &&
        [UPLOAD_PREFIX, VERIFIED_PREFIX].some((prefix) => candidatePath.startsWith(`${basePath}/${prefix}`))
      );
    });
  }

  async authorizeUpload(storageKey: string, byteSize: number): Promise<Result<ProductImageUpload, BusinessError>> {
    const signedAt = now();
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: WEBP_CONTENT_TYPE,
      ContentLength: byteSize,
    });
    return getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_TTL_SECONDS,
      signingDate: signedAt,
      signableHeaders: new Set(["content-type", "content-length"]),
    })
      .then((uploadUrl) =>
        ok({
          uploadUrl,
          expiresAt: new Date(signedAt.getTime() + UPLOAD_TTL_SECONDS * 1000),
          headers: { "content-type": WEBP_CONTENT_TYPE, "content-length": byteSize.toString() },
        }),
      )
      .catch((error: unknown) => this.storageError(error, "authorize"));
  }

  async verifyUpload(
    storageKey: string,
    expectedByteSize: number,
  ): Promise<Result<VerifiedProductImage, BusinessError>> {
    if (!storageKey.startsWith(UPLOAD_PREFIX)) {
      return this.storageError(new Error("Unexpected product image upload key"), "read");
    }

    const stored = await this.client
      .send(new GetObjectCommand({ Bucket: this.bucket, Key: storageKey }))
      .then(ok)
      .catch((error: unknown) => {
        if (
          error instanceof S3ServiceException &&
          (error.name === "NoSuchKey" || (error.name === "NotFound" && error.$metadata.httpStatusCode === 404))
        ) {
          return err({
            code: codes.conflictError,
            message: "Upload the image to the authorized URL before verifying it.",
            details: [],
          });
        }
        return this.storageError(error, "read");
      });
    if (!stored.success) {
      return stored;
    }

    const { Body, ContentType, ContentLength } = stored.value;
    if (!(Body instanceof Readable)) {
      return this.storageError(new Error("S3 returned no readable body"), "read");
    }
    if (ContentLength !== expectedByteSize || ContentLength > MAX_PRODUCT_IMAGE_BYTE_SIZE) {
      Body.destroy();
      return invalidImage("The uploaded image size does not match the authorized size.");
    }
    if (ContentType !== WEBP_CONTENT_TYPE) {
      Body.destroy();
      return invalidImage("The uploaded image must have Content-Type image/webp.");
    }

    const read = await Body.transformToByteArray()
      .then(ok)
      .catch((error: unknown) => this.storageError(error, "read"));
    if (!read.success) {
      return read;
    }

    const bytes = read.value;
    const signature = Buffer.from(bytes.subarray(0, WEBP_SIGNATURE_LENGTH));
    if (bytes.byteLength !== expectedByteSize) {
      return invalidImage("The uploaded image size does not match the authorized size.");
    }
    if (
      bytes.byteLength < WEBP_SIGNATURE_LENGTH ||
      signature.toString("latin1", 0, 4) !== "RIFF" ||
      signature.toString("latin1", 8, 12) !== "WEBP"
    ) {
      return invalidImage("The uploaded image does not have a WebP signature.");
    }

    // Only this checked byte sequence can write to its content-addressed key.
    const digest = createHash("sha256").update(bytes).digest("hex");
    const objectName = storageKey.slice(UPLOAD_PREFIX.length).replace(/\.webp$/, "");
    const verifiedKey = `${VERIFIED_PREFIX}${objectName}-${digest}.webp`;
    return this.client
      .send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: verifiedKey,
          Body: bytes,
          ContentLength: bytes.byteLength,
          ContentType: WEBP_CONTENT_TYPE,
          CacheControl: "public, max-age=31536000, immutable",
        }),
      )
      .then(() => ok({ storageKey: verifiedKey, publicUrl: `${this.publicBaseUrl}/${verifiedKey}` }))
      .catch((error: unknown) => this.storageError(error, "publish"));
  }

  private storageError(error: unknown, operation: string) {
    this.logger.error({ err: error, operation }, "Product image storage request failed");
    return err(INTERNAL_SEVER_ERROR);
  }
}

export {
  MAX_PRODUCT_IMAGE_BYTE_SIZE,
  ProductImageStore,
  WEBP_SIGNATURE_LENGTH,
  productImageUploadKey,
  type ProductImageUpload,
};
