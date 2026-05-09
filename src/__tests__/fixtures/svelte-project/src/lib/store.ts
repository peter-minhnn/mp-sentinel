import { writable } from "svelte/store";

export const user = writable<string | null>(null);

export function resetUser(): void {
  user.set(null);
}
