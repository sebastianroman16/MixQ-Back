import { PartialType } from '@nestjs/mapped-types';
import { CreateFrequentClientDto } from './create-frequent-client.dto';

export class UpdateFrequentClientDto extends PartialType(
  CreateFrequentClientDto,
) {}
