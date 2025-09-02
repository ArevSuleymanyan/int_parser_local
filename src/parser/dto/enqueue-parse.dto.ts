import { IsArray, ArrayMinSize, IsString, IsUrl } from 'class-validator';

export class EnqueueParseDto {
  @IsString()
  leadId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  fields?: string[];

  @IsUrl()
  url!: string;

  @IsUrl()
  webhookUrl!: string;
}
