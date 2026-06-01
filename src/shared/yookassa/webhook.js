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

      if (event !== 'payment.succeeded' || !payment?.id) {
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

      if (result.ok && notifyUser) {
        await notifyUser(result);
      }

      res.status(200).send('');
    } catch (err) {
      console.error('[yookassa] webhook error:', err?.message ?? err);
      res.status(500).send('Error');
    }
  };
}
