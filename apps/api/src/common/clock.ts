import { Injectable } from '@nestjs/common';

/** Source of the current time. Injected so that tests can move time forward. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}
