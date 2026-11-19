import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { codes } from "../../../src/contracts/business-error.ts";
import { tables } from "../../../src/db/schema.ts";
import { ProductFinder } from "../../../src/finders/product-finder.ts";
import { noopLogger } from "../../../src/infra/config.logger.ts";
import type { ProductImageStore } from "../../../src/integrations/product-image-store.ts";
import { AuthorizeProductImageUploadService } from "../../../src/services/catalog/products/authorize-product-image-upload-service.ts";
import { VerifyProductImageUploadService } from "../../../src/services/catalog/products/verify-product-image-upload-service.ts";
import { generateId } from "../../../src/utils/generate-id.ts";
import { err, ok } from "../../../src/utils/result.ts";
import { prepareDatabase } from "../../prepare-db.ts";
import {
  createRealtimeEventPublisherMock,
  trackCommittedBroadcasts,
} from "../../test-utils/realtime-publisher-mock.ts";
import { CollectionFinder } from "../../../src/finders/collection-finder.ts";

const EXISTING_IMAGE = "https://strawhatpirates.example.com/sea-chart.webp";
const PUBLISHED_IMAGE = "https://storage.example.com/product-photos/verified/sea-chart.webp";
const WEBP_BYTE_SIZE = 36;

async function setup() {
  const db = await prepareDatabase();
  const merchantId = generateId({ model: "merchant" });
  const otherMerchantId = generateId({ model: "merchant" });
  const productId = generateId({ model: "product" });
  const otherProductId = generateId({ model: "product" });
  const existingImageId = generateId({ model: "img" });
  const baseline = new Date("2026-01-01T00:00:00.000Z");

  await db.insert(tables.merchant).values([
    { id: merchantId, name: "Straw Hat Pirates", country: "ni" },
    { id: otherMerchantId, name: "Heart Pirates", country: "ni" },
  ]);
  await db.insert(tables.product).values([
    {
      id: productId,
      merchantId,
      slug: "nami-sea-chart",
      name: "Nami's sea chart consultation",
      price: "30.00",
      unitCost: "0.00",
      type: "service",
      status: "active",
      createdAt: baseline,
      updatedAt: baseline,
    },
    {
      id: otherProductId,
      merchantId: otherMerchantId,
      slug: "laws-consultation",
      name: "Law's consultation",
      price: "50.00",
      unitCost: "0.00",
      type: "service",
      status: "active",
      createdAt: baseline,
      updatedAt: baseline,
    },
  ]);
  await db.insert(tables.productImage).values({
    id: existingImageId,
    productId,
    merchantId,
    source: "remote",
    status: "available",
    remoteUrl: EXISTING_IMAGE,
    activatedAt: baseline,
    createdAt: baseline,
    updatedAt: baseline,
  });

  const productImageStore = {
    authorizeUpload: vi.fn<ProductImageStore["authorizeUpload"]>().mockImplementation(async (storageKey, byteSize) =>
      ok({
        uploadUrl: `https://storage.example.com/product-photos/${storageKey}?signed=1`,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        headers: { "content-type": "image/webp", "content-length": String(byteSize) },
      }),
    ),
    verifyUpload: vi.fn<ProductImageStore["verifyUpload"]>().mockImplementation(async (storageKey) =>
      ok({
        storageKey: storageKey.replace("/uploads/", "/verified/"),
        publicUrl: PUBLISHED_IMAGE,
      }),
    ),
  };
  const productFinder = new ProductFinder(new CollectionFinder());
  const { publisher, broadcast } = createRealtimeEventPublisherMock();
  const user = {
    id: "nami",
    employeeId: "nami",
    accountType: "owner" as const,
    email: "nami@strawhatpirates.example.com",
    merchantId,
  };
  const dependencies = { logger: noopLogger(), db, productFinder, productImageStore, publisher, user };

  return {
    authorize: AuthorizeProductImageUploadService.create(dependencies),
    verify: VerifyProductImageUploadService.create(dependencies),
    verifyAsOtherMerchant: VerifyProductImageUploadService.create({
      ...dependencies,
      user: { ...user, merchantId: otherMerchantId },
    }),
    productImageStore,
    merchantId,
    productId,
    otherProductId,
    db,
    existingImageId,
    baseline,
    broadcast,
    productFinder,
  };
}

async function authorizeUpload(authorize: AuthorizeProductImageUploadService, productId: string) {
  const result = await authorize.execute([productId, { byteSize: WEBP_BYTE_SIZE }]);
  if (!result.success) {
    throw new Error(result.error.message);
  }
  return result.value;
}

afterEach(() => vi.restoreAllMocks());

describe("Product image upload authorization", () => {
  it("persists the authorized upload, supersedes only pending uploads, and leaves the catalog unchanged", async () => {
    const { authorize, productId, merchantId, db, existingImageId, productFinder, broadcast, baseline } = await setup();
    const siblingProductId = generateId({ model: "product" });
    await db.insert(tables.product).values({
      id: siblingProductId,
      merchantId,
      name: "Log Pose",
      slug: "log-pose",
      price: "20.00",
      unitCost: "5.00",
      createdAt: baseline,
      updatedAt: baseline,
    });
    const siblingUpload = await authorizeUpload(authorize, siblingProductId);
    const first = await authorizeUpload(authorize, productId);

    const second = await authorizeUpload(authorize, productId);

    expect(second.id).not.toBe(first.id);
    expect(second.uploadUrl).toContain(`/product-images/uploads/${merchantId}/${productId}/${second.id}.webp`);
    expect(await db.select().from(tables.productImage)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: existingImageId, archivedAt: null, status: "available" }),
        expect.objectContaining({ id: siblingUpload.id, status: "pending", archivedAt: null }),
        expect.objectContaining({ id: first.id, status: "pending", archivedAt: expect.any(Date) }),
        expect.objectContaining({
          id: second.id,
          merchantId,
          productId,
          source: "managed",
          status: "pending",
          remoteUrl: null,
          declaredByteSize: WEBP_BYTE_SIZE,
          uploadExpiresAt: second.expiresAt,
          archivedAt: null,
        }),
      ]),
    );
    expect(await productFinder.find(db, { id: productId, merchantId })).toMatchObject({ imageUrl: EXISTING_IMAGE });
    expect(
      await productFinder.findForSync(db, {
        merchantId,
        previousSyncedAt: new Date(baseline.getTime() + 1),
        currentSyncedAt: new Date(),
      }),
    ).toEqual([]);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("does not sign an upload for another merchant's product", async () => {
    const { authorize, otherProductId, productImageStore, db, existingImageId } = await setup();

    const result = await authorize.execute([otherProductId, { byteSize: WEBP_BYTE_SIZE }]);

    expect(result).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    expect(productImageStore.authorizeUpload).not.toHaveBeenCalled();
    expect(await db.select({ id: tables.productImage.id }).from(tables.productImage)).toEqual([
      { id: existingImageId },
    ]);
  });
});

describe("Product image upload verification", () => {
  it("activates the verified photo and exposes it to incremental sync and realtime exactly once", async () => {
    const {
      authorize,
      verify,
      db,
      productId,
      merchantId,
      productFinder,
      existingImageId,
      baseline,
      broadcast,
      productImageStore,
    } = await setup();
    const authorizedAt = new Date("2026-02-01T12:00:00.000Z").getTime();
    const clock = vi.spyOn(Date, "now").mockReturnValue(authorizedAt);
    const { id } = await authorizeUpload(authorize, productId);
    clock.mockReturnValue(authorizedAt + 24 * 60 * 60 * 1000 - 1);
    const committedAtPublish = trackCommittedBroadcasts(db, broadcast);

    const first = await verify.execute([productId, id]);
    const retry = await verify.execute([productId, id]);

    expect(first).toMatchObject({
      success: true,
      value: { id: productId, imageUrl: PUBLISHED_IMAGE, name: "Nami's sea chart consultation", price: "30.00" },
    });
    expect(retry).toEqual(first);
    expect(productImageStore.verifyUpload).toHaveBeenCalledTimes(1);
    expect(committedAtPublish).toEqual([true]);
    expect(broadcast).toHaveBeenCalledExactlyOnceWith({
      merchantId,
      resource: { type: "product", snapshot: first.value },
    });
    expect(await db.select().from(tables.productImage)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: existingImageId, archivedAt: expect.any(Date), status: "available" }),
        expect.objectContaining({
          id,
          remoteUrl: PUBLISHED_IMAGE,
          status: "available",
          activatedAt: expect.any(Date),
          archivedAt: null,
        }),
      ]),
    );
    expect(
      await productFinder.findForSync(db, {
        merchantId,
        previousSyncedAt: new Date(baseline.getTime() + 1),
        currentSyncedAt: new Date(Date.now() + 1),
      }),
    ).toEqual([first.value]);
  });

  it("rejects a valid upload ID when requested with a different merchant or product", async () => {
    const { authorize, verify, verifyAsOtherMerchant, productId, otherProductId, productImageStore } = await setup();
    const { id } = await authorizeUpload(authorize, productId);

    const wrongMerchant = await verifyAsOtherMerchant.execute([productId, id]);
    const wrongProduct = await verify.execute([otherProductId, id]);

    expect(wrongMerchant).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    expect(wrongProduct).toMatchObject({ success: false, error: { code: codes.resourceNotFound } });
    expect(productImageStore.verifyUpload).not.toHaveBeenCalled();
  });

  it("returns the verified photo when a removal commits during a verification retry", async () => {
    const { authorize, verify, productId, db, productFinder, merchantId } = await setup();
    const { id } = await authorizeUpload(authorize, productId);
    const verified = await verify.execute([productId, id]);
    const readStarted = Promise.withResolvers<void>();
    const readFinished = Promise.withResolvers<void>();
    const find = productFinder.find.bind(productFinder);
    vi.spyOn(productFinder, "find").mockImplementationOnce(async (...args) => {
      readStarted.resolve();
      await readFinished.promise;
      return find(...args);
    });

    const retry = verify.execute([productId, id]);
    await readStarted.promise;
    await db.update(tables.productImage).set({ archivedAt: new Date() }).where(eq(tables.productImage.id, id));
    readFinished.resolve();

    expect(verified).toMatchObject({ success: true, value: { imageUrl: PUBLISHED_IMAGE } });
    expect(await retry).toEqual(verified);
    expect(await productFinder.find(db, { id: productId, merchantId })).toMatchObject({ imageUrl: null });
  });

  it("keeps the existing photo when storage rejects the replacement", async () => {
    const { authorize, verify, productId, productImageStore, db, productFinder, merchantId, broadcast } = await setup();
    const { id } = await authorizeUpload(authorize, productId);
    productImageStore.verifyUpload.mockResolvedValueOnce(
      err({
        code: codes.validationError,
        message: "The uploaded image size does not match the authorized size.",
        details: [],
      }),
    );

    const result = await verify.execute([productId, id]);

    expect(result).toMatchObject({ success: false, error: { code: codes.validationError } });
    expect(await productFinder.find(db, { id: productId, merchantId })).toMatchObject({ imageUrl: EXISTING_IMAGE });
    expect(await db.select().from(tables.productImage).where(eq(tables.productImage.id, id))).toEqual([
      expect.objectContaining({ status: "pending", archivedAt: null }),
    ]);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("rejects a pending upload exactly 24 hours after authorization without reading storage", async () => {
    const { authorize, verify, productId, productImageStore, broadcast } = await setup();
    const authorizedAt = new Date("2026-02-01T12:00:00.000Z").getTime();
    const clock = vi.spyOn(Date, "now").mockReturnValue(authorizedAt);
    const { id } = await authorizeUpload(authorize, productId);
    clock.mockReturnValue(authorizedAt + 24 * 60 * 60 * 1000);

    const result = await verify.execute([productId, id]);

    expect(result).toMatchObject({ success: false, error: { code: codes.conflictError } });
    expect(productImageStore.verifyUpload).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });

  it("cannot activate an upload superseded while its stored bytes are being checked", async () => {
    const { authorize, verify, productId, productImageStore, db, productFinder, merchantId, broadcast } = await setup();
    const { id } = await authorizeUpload(authorize, productId);
    const storageStarted = Promise.withResolvers<void>();
    const storageFinished = Promise.withResolvers<void>();
    productImageStore.verifyUpload.mockImplementationOnce(async (storageKey) => {
      storageStarted.resolve();
      await storageFinished.promise;
      return ok({ storageKey: storageKey.replace("/uploads/", "/verified/"), publicUrl: PUBLISHED_IMAGE });
    });

    const verification = verify.execute([productId, id]);
    await storageStarted.promise;
    await authorizeUpload(authorize, productId);
    storageFinished.resolve();
    const result = await verification;

    expect(result).toMatchObject({ success: false, error: { code: codes.conflictError } });
    expect(await productFinder.find(db, { id: productId, merchantId })).toMatchObject({ imageUrl: EXISTING_IMAGE });
    expect(broadcast).not.toHaveBeenCalled();
  });
});
