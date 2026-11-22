// Booking work on the platform's minute cron, against the EmDash runtime (outside any request):
// keep the booking plugin's MCP tools turned on for connectors, then its maintenance route
// (expire unconfirmed holds, reminders, retention, the customer's calendar), which itself runs
// at most every 5 minutes.
import { BOOKING_PLUGIN_ID } from '../booking/store.js';
import { enablePluginTools, type FormToolsRuntime } from './form-tools.js';

export async function bookingCronPass(): Promise<void> {
  const { withEmDashRuntime } = await import('emdash/middleware');
  await withEmDashRuntime(async (runtime) => {
    if (await enablePluginTools(runtime as unknown as FormToolsRuntime, BOOKING_PLUGIN_ID))
      console.log('[himlio] booking: MCP tools turned on for connectors');
    const result = (await runtime.handlePluginApiRoute(
      BOOKING_PLUGIN_ID,
      'POST',
      '/maintenance',
      new Request('https://internal/maintenance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    )) as { success?: boolean };
    if (!result?.success)
      throw new Error(`booking maintenance failed: ${JSON.stringify(result).slice(0, 300)}`);
  });
}
