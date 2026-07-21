export interface HiggsfieldJobData {
  prompt: string;
  model: string;
  ratio: string;
  styleReference: { mediaUrl: string; higgsfieldMediaRef: string } | null;
  productImages: { mediaUrl: string; higgsfieldMediaRef: string }[];
  taskId?: string;
  createdAt: number;
  duration: number;
  pollAfterSeconds?: number;
  branding?: {
    enabled: boolean;
    includeLogo?: boolean;
    includeAddress?: boolean;
    clientId?: string;
  };
}

export const activeJobs = new Map<string, HiggsfieldJobData>();
