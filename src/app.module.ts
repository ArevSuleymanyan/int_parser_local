import { Module } from '@nestjs/common';
import { ParserModule } from './parser/parser.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ParserModule],
  controllers: [],
  providers: [],
})
export class AppModule {}
