import { Body, Controller, Logger, Post } from '@nestjs/common';
import { ParserService } from './parser.service';
import { EnqueueParseDto } from './dto/enqueue-parse.dto';

@Controller('parser')
export class ParserController {
  private readonly logger = new Logger(ParserController.name);
  constructor(private readonly service: ParserService) {}

  @Post('enqueue')
  async enqueue(@Body() dto: EnqueueParseDto) {
    console.log(123);
    return this.service.enqueue(dto);
  }
}
