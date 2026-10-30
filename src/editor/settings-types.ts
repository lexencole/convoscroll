import type { ConversationDocument } from "../data/conversation-types";
import type { AssetSourceResolver } from "../renderer/ConversationCanvas";
import type { AssetTarget } from "./workbench-operations";
import type { IdentityControls } from "./MessageIdentityFields";

export type SettingsTarget ={ readonly type: "document" } | { readonly type: "message"; readonly messageId: string }
  | { readonly type: "block"; readonly messageId: string; readonly blockId: string };
export interface SettingsSession { readonly target: SettingsTarget; readonly base: ConversationDocument; readonly trigger?: HTMLElement }


export interface WorkbenchSettingsProps {
  session: SettingsSession;
  /** The live document and its history; the identity panel also writes through it. */
  identity: IdentityControls;
  resolveAssetSource: AssetSourceResolver;
  onPendingChange: (pending: boolean) => void;
  /** Saves the edited document at once; throws if it cannot. `previous` is the document the edit started from. */
  onChange: (next: ConversationDocument, group: string, previous: ConversationDocument) => void;
  onAttach: (file: File, target: AssetTarget) => Promise<void>;
  onClose: () => void;
}
