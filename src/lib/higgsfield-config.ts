export const HIGGSFIELD_CONFIG = {
  models: {
    "Nano Banana Pro": "nano_banana_pro",
    "Nano Banana 2": "nano_banana_2",
    "nano_banana_pro": "nano_banana_pro",
    "nano_banana_2": "nano_banana_2",
    "GPT Image 2": "gpt_image_2",
    "gpt_image_2": "gpt_image_2",
  },
  modelCosts: {
    "nano_banana_pro": 1.5,
    "nano_banana_2": 1.0,
    "nano_banana": 1.0,
    "Nano Banana Pro": 1.5,
    "Nano Banana 2": 1.0,
    "gpt_image_2": 2.0,
    "GPT Image 2": 2.0,
  },
  defaultModel: "nano_banana_pro",
  defaultModelDisplayName: "Nano Banana Pro",
  resolution: "1k",
  monthlyLimitAlert: 100, // Credit warning threshold
  referenceCleanupTemplate: "Recreate the style/scene from the reference, but render a completely clean image — do not reproduce any text, watermarks, logos, or labels present in the reference.",
};
