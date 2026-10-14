import { modelDelivery } from '../../../src/lib/model-assets/delivery.ts';
import { MODEL_ASSETS } from '../../../src/lib/model-assets/manifest.ts';
export const onRequest = modelDelivery(
	MODEL_ASSETS.filter((model) => model.tool === 'bg-remove'),
);
