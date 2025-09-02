import axios from 'axios';
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ResultWebhookService {
  private readonly logger = new Logger(ResultWebhookService.name);

  async send(webhookUrl: string, body: any) {
    const res = await axios.post(webhookUrl, body, {
      timeout: 10000,
      headers: { 'Content-Type': 'application/json' },
      validateStatus: () => true,
    });
    if (res.status >= 200 && res.status < 300) return true;
    this.logger.error(`Webhook POST failed: ${res.status} ${res.statusText}`);
    throw new Error(`Webhook ${res.status}`);
  }
}
