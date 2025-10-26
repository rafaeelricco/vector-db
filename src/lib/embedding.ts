export { generateEmbedding, generateEmbeddings };

import { Future } from '@/lib/future';
import { pipeline, FeatureExtractionPipeline } from '@huggingface/transformers';

let modelInstance: FeatureExtractionPipeline | null = null;
let modelLoadingPromise: Promise<FeatureExtractionPipeline> | null = null;

const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIMENSIONS = 384;

async function loadModel(): Promise<FeatureExtractionPipeline> {
  if (modelInstance) {
    return modelInstance;
  }
  

  if (modelLoadingPromise) {
    return modelLoadingPromise;
  }

  modelLoadingPromise = (async () => {
    console.log(`Loading embedding model: ${MODEL_NAME}...`);
    const model = await pipeline('feature-extraction', MODEL_NAME);
    console.log(`Model loaded successfully. Dimensions: ${EMBEDDING_DIMENSIONS}`);
    modelInstance = model;
    return model;
  })();

  return modelLoadingPromise;
}

function generateEmbedding(text: string): Future<Error, number[]> {
  return Future.attemptP(async () => {
    if (!text || text.trim().length === 0) {
      throw new Error('Text input cannot be empty');
    }

    const model = await loadModel();
    const output = await model(text, {
      pooling: 'mean',
      normalize: true,
    });

    const embedding = Array.from(output.data) as number[];

    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(
        `Unexpected embedding dimensions: ${embedding.length} (expected ${EMBEDDING_DIMENSIONS})`
      );
    }

    return embedding;
  });
}

function generateEmbeddings(texts: string[]): Future<Error, number[][]> {
  return Future.attemptP(async () => {
    if (!texts || texts.length === 0) {
      throw new Error('Texts array cannot be empty');
    }

    const validTexts = texts.filter((t) => t && t.trim().length > 0);
    if (validTexts.length !== texts.length) {
      throw new Error('All text inputs must be non-empty strings');
    }

    const model = await loadModel();
    const output = await model(texts, { pooling: 'mean', normalize: true });

    const embeddings: number[][] = [];
    const dataArray = Array.from(output.data) as number[];

    for (let i = 0; i < texts.length; i++) {
      const start = i * EMBEDDING_DIMENSIONS;
      const end = start + EMBEDDING_DIMENSIONS;
      embeddings.push(dataArray.slice(start, end));
    }

    return embeddings;
  });
}

