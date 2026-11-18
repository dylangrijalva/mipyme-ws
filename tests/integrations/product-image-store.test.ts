import { describe, expect, it } from "vitest";
import { noopLogger } from "../../src/infra/config.logger.ts";
import { ProductImageStore } from "../../src/integrations/product-image-store.ts";
import { createRealtimeEnv } from "../test-utils/realtime-env.ts";

const productImageStore = new ProductImageStore({
  env: {
    ...createRealtimeEnv(),
    BUCKET_STORAGE_ENDPOINT: "https://uploads.example.com",
    BUCKET_STORAGE_PUBLIC_BASE_URL: "https://photos.example.com",
  },
  logger: noopLogger(),
});

describe("Managed product image URLs", () => {
  it.each([
    ["https://uploads.example.com/strawhatpirates/product-images/uploads/nami.webp", true],
    ["https://strawhatpirates.uploads.example.com/product-images/uploads/nami.webp", true],
    ["https://photos.example.com/strawhatpirates/product-images/verified/nami.webp", true],
    ["https://photos.example.com/strawhatpirates/product-images/%76erified/nami.webp", true],
    ["https://photos.example.com/strawhatpirates/sea-chart.webp", false],
    ["https://photos.example.com:8443/strawhatpirates/product-images/verified/nami.webp", false],
    ["http://photos.example.com/strawhatpirates/product-images/verified/nami.webp", false],
  ])("classifies %s as managed = %s", (url, isManaged) => {
    expect(productImageStore.isManagedUrl(url)).toBe(isManaged);
  });
});
