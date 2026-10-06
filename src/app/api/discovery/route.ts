import { handleDiscoveryRequest } from '@/lib/discovery-api';

// Standard Next development has no shared hosted transcript binding.
export function GET(request: Request) {
  return handleDiscoveryRequest(request);
}
