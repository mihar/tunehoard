export function log(message: string, data?: Record<string, unknown>) {
  console.log(JSON.stringify({ message, ...data, timestamp: new Date().toISOString() }));
}
