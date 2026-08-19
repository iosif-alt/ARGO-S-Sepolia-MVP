import { expect } from 'chai';
import { AuthService } from '../src/auth-service';
import { InMemoryRepository } from '../src/in-memory-repository';

describe('ARGO-S local authentication', () => {
  it('hashes credentials and returns a verifiable role session', async () => {
    const repository = new InMemoryRepository();
    const auth = new AuthService(repository, 'test-secret');
    const user = await auth.createUser('Maker@ARGO.local', 'MakerDemo123!', 'MAKER');
    expect(user.passwordHash).not.to.contain('MakerDemo123!');
    const session = await auth.login('maker@argo.local', 'MakerDemo123!');
    expect(auth.verify(session.token)).to.include({ email: 'maker@argo.local', role: 'MAKER' });
  });

  it('rejects a modified session token', async () => {
    const repository = new InMemoryRepository();
    const auth = new AuthService(repository, 'test-secret');
    await auth.createUser('checker@argo.local', 'CheckerDemo123!', 'CHECKER');
    const session = await auth.login('checker@argo.local', 'CheckerDemo123!');
    expect(() => auth.verify(`${session.token}x`)).to.throw('Invalid session');
  });
});
