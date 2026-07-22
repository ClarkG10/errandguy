import { Module } from '@nestjs/common';
import { ProfileController } from './profile.controller';
import { SavedAddressController } from './saved-address.controller';
import { TrustedContactController } from './trusted-contact.controller';

@Module({
  controllers: [ProfileController, SavedAddressController, TrustedContactController],
})
export class UserModule {}
