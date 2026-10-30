import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ConversationAsset, ImageBlock } from "../data/conversation-types";
import { ImageBlockView } from "./ImageBlockView";

const firstAsset: ConversationAsset = {
  id: "asset-image-first",
  kind: "image",
  fileName: "first.png",
  mimeType: "image/png",
  source: { kind: "local", storageKey: "local:first" },
};

const firstBlock: ImageBlock = {
  id: "block-image-first",
  type: "image",
  assetId: firstAsset.id,
  alt: "first image",
};

describe("ImageBlockView", () => {
  it("retries rendering after the asset source or identity changes", async () => {
    let source = "blob:first";
    const resolveAssetSource = () => source;
    const { rerender } = render(
      <ImageBlockView block={firstBlock} asset={firstAsset} resolveAssetSource={resolveAssetSource} />,
    );

    fireEvent.error(screen.getByRole("img", { name: "first image" }));
    expect(screen.getByRole("note")).toHaveTextContent("图片打不开");

    source = "blob:second";
    rerender(<ImageBlockView block={firstBlock} asset={firstAsset} resolveAssetSource={resolveAssetSource} />);
    await waitFor(() => expect(screen.getByRole("img", { name: "first image" })).toHaveAttribute("src", "blob:second"));

    fireEvent.error(screen.getByRole("img", { name: "first image" }));
    const secondAsset: ConversationAsset = {
      ...firstAsset,
      id: "asset-image-second",
      fileName: "second.png",
      source: { kind: "local", storageKey: "local:second" },
    };
    const secondBlock: ImageBlock = {
      ...firstBlock,
      assetId: secondAsset.id,
      alt: "second image",
    };
    rerender(<ImageBlockView block={secondBlock} asset={secondAsset} resolveAssetSource={resolveAssetSource} />);

    await waitFor(() => expect(screen.getByRole("img", { name: "second image" })).toHaveAttribute("src", "blob:second"));
  });
});
