export type ObserverError = Error & { code: string };

export function observerError(code: string, message = code): ObserverError {
  const error = new Error(message) as ObserverError;
  error.code = code;
  return error;
}
