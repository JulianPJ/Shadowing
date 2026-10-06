import { handleQuizRequest } from '@/lib/quiz-api';
import { localRequirePro } from '@/lib/auth/local-handler';

export const maxDuration = 45;

export async function POST(request: Request) {
  const denied = await localRequirePro(request);
  return denied ?? handleQuizRequest(request);
}
