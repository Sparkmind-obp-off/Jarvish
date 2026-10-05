import type { JarvishPermissionLevel } from "./index.js";

export const permissionRequiresConfirmation = (level: JarvishPermissionLevel) =>
  level >= 2;

export function assertPermission(
  level: JarvishPermissionLevel,
  confirmed: boolean,
): void {
  if (permissionRequiresConfirmation(level) && !confirmed) {
    throw new Error("Confirmation required for this action.");
  }
}
