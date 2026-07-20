export interface HiggsfieldJobData {
  prompt: string;
  model: string;
  ratio: string;
  styleReference: { mediaUrl: string; higgsfieldMediaRef: string } | null;
  productImages: { mediaUrl: string; higgsfieldMediaRef: string }[];
  taskId?: string;
  createdAt: number;
  duration: number;
}

export const activeJobs = new Map<string, HiggsfieldJobData>();
