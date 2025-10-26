import { pipeline } from "@huggingface/transformers";

const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
  dtype: "q8",
});

const embedding = await extractor("Hello world!", {
  pooling: "mean",
  normalize: true,
});

console.log('Embedding vector:', embedding);