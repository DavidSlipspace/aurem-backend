export type IpcmDirectoryStatus =
  | "active"
  | "invited"
  | "expired";

export type IpcmPaymentSetupStatus =
  | "not_started"
  | "in_progress"
  | "configured";

export type IpcmDirectoryItem = {
  id: string;

  type:
    | "user"
    | "invitation";

  firstName:
    | string
    | null;

  lastName:
    | string
    | null;

  email: string;

  status:
    IpcmDirectoryStatus;

  paymentStatus:
    IpcmPaymentSetupStatus;

  invitationSentAt:
    | string
    | null;

  invitationExpiresAt:
    | string
    | null;
};

export type IpcmDirectoryResponse = {
  canInvite: boolean;

  ipcms:
    IpcmDirectoryItem[];
};

export type InviteIpcmRequest = {
  email: string;
};

export type InviteIpcmResponse = {
  message: string;

  invitation:
    IpcmDirectoryItem;

  expiresAt: string;

  sentTo: string;
};