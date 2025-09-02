import { Module } from '@nestjs/common';
import { ParserController } from './parser.controller';
import { ParserService } from './parser.service';
import { BullModule } from '@nestjs/bull';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PARSE_QUEUE } from './queue.constants';
import { ResultWebhookService } from './webhook.service';
import { ParseProcessor } from './parse.processor';

@Module({
  controllers: [ParserController],
  providers: [ParserService, ParseProcessor, ResultWebhookService],
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => {
        const redisOptions = {
          host: configService.get<string>('REDIS_HOST'),
          port: configService.get<number>('REDIS_PORT'),
        };

        return {
          redis: redisOptions,
          prefix: configService.get('REDIS_PREFIX'),
        };
      },
      inject: [ConfigService],
    }),
    BullModule.registerQueue({
      name: PARSE_QUEUE,
    }),
  ],
})
export class ParserModule {}
