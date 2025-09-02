import { Body, Controller, Logger, Post } from '@nestjs/common';
import { ParserService } from './parser.service';
import { EnqueueParseDto } from './dto/enqueue-parse.dto';

@Controller('parser')
export class ParserController {
  private readonly logger = new Logger(ParserController.name);
  constructor(private readonly service: ParserService) {}

  @Post('enqueue')
  async enqueue(@Body() dto: EnqueueParseDto) {
    this.logger.log(
      `Запрос на постановку в очередь: leadId=${dto.leadId} поля=[${dto.fields.join(',')}] url=${dto.url}`,
    );
    const res = await this.service.enqueue(dto);
    this.logger.log(
      `Задача поставлена в очередь: jobId=${res.jobId} leadId=${dto.leadId}`,
    );
    return res;
  }
}
