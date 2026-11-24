export interface TelegramImportStatus {
  configured: boolean;
  connected: boolean;
  enabled: boolean;
  channelId: string | null;
  channelTitle: string | null;
  lastCheckedAt: string | null;
  lastImportedAt: string | null;
  error: string | null;
  loginStep: "idle" | "code" | "password";
}

export interface TelegramChannelOption {
  id: string;
  title: string;
}

export interface TelegramServiceDraft {
  id: string;
  channelTitle: string;
  sourceUrl: string | null;
  sourceMessageId: number;
  sourcePostedAt: string;
  title: string;
  description: string;
  serviceId: string;
  matureContent: boolean;
  status: string;
  publishedUpdateId: string | null;
  createdAt: string;
  updatedAt: string;
}
