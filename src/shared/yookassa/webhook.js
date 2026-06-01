import { config } from '../config.js';
import * as payments from '../payments.js';
import { isYookassaIp } from './ip-check.js';

export function createYookassaWebhookHandler({ notifyUser }) {
  return async (req, res) => {
    try {
      const clientIp =
        req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ||
        req.socket.remoteAddress;

      if (!config.yookassaSkipIpCheck && !isYookassaIp(clientIp)) {
        console.warn('[yookassa] webhook from unknown IP:', clientIp);
        res.status(403).send('Forbidden');
        return;
      }

      const event = req.body?.event;
      const payment = req.body?.object;

      console.log(`[yookassa] webhook received: event=${event} payment=${payment?.id} ip=${clientIp}`);

      if (event !== 'payment.succeeded' || !payment?.id) {
        console.log(`[yookassa] webhook ignored (not payment.succeeded)`);
        res.status(200).send('');
        return;
      }

      const paymentCode = payment.metadata?.payment_code;
      if (!paymentCode) {
        console.warn('[yookassa] payment without payment_code:', payment.id);
        res.status(200).send('');
        return;
      }

      const result = await payments.completeYookassaPayment(paymentCode, payment.id);
      console.log(
        `[yookassa] processed: code=${paymentCode} ok=${result.ok}` +
          (result.alreadyGranted ? ' (already granted)' : '') +
          (result.reason ? ` reason=${result.reason}` : ''),
      );

      if (result.ok && !result.alreadyGranted && notifyUser) {
        await notifyUser(result);
      }

      res.status(200).send('');
    } catch (err) {
      console.error('[yookassa] webhook error:', err?.message ?? err);
      res.status(500).send('Error');
    }
  };
}
