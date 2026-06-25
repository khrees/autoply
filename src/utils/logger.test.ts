import { describe, test, expect, spyOn, beforeEach } from 'bun:test';
import { setVerbose, logger, pinoLogger } from './logger';

describe('logger verbose mode', () => {
  let debugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    // Spy on the pino child logger's debug method (all log output goes through pino)
    debugSpy = spyOn(pinoLogger, 'debug').mockImplementation(() => pinoLogger);
    setVerbose(false);
    delete process.env.DEBUG;
  });

  test('debug does not log when verbose is off', () => {
    logger.debug('test message');
    expect(debugSpy).not.toHaveBeenCalled();
  });

  test('debug logs when verbose is on', () => {
    setVerbose(true);
    logger.debug('test message');
    expect(debugSpy).toHaveBeenCalled();
  });

  test('debug logs when DEBUG env is set', () => {
    process.env.DEBUG = '1';
    logger.debug('test message');
    expect(debugSpy).toHaveBeenCalled();
  });
});
