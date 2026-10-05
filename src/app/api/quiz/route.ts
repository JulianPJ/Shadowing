import { handleQuizRequest } from '@/lib/quiz-api';

export const maxDuration = 45;

export async function POST(request: Request) {
  return handleQuizRequest(request);
}
