import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { PARSE_QUEUE } from './queue.constants';
import { EnqueueParseDto } from './dto/enqueue-parse.dto';

@Injectable()
export class ParserService {
  private readonly logger = new Logger(ParserService.name);

  constructor(@InjectQueue(PARSE_QUEUE) private readonly queue: Queue) {}

  async enqueue(dto: EnqueueParseDto) {
    const payload = {
      leadId: dto.leadId,
      fields: dto.fields,
      url: dto.url,
      webhookUrl: dto.webhookUrl,
    };

    const job = await this.queue.add('parse', payload, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: false,
    });

    return { ok: true, jobId: job.id };
  }
}
