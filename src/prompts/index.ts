import { loadPrompt } from './loader';

export function getCooperSystemPrompt(): string {
  const persona = loadPrompt('system/cooper.system.md');
  return persona;
}

export function getScheduleIntentPrompt(variables: { timezone: string }): string {
  return loadPrompt('tasks/scheduleIntent.task.md', variables);
}