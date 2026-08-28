import { compressProofImage, PROOF_MAX_EDGE } from '../proofImage';
import { ImageManipulator } from 'expo-image-manipulator';

jest.mock('expo-image-manipulator', () => ({
  ImageManipulator: { manipulate: jest.fn() },
  SaveFormat: { JPEG: 'jpeg' },
}));

const manipulate = ImageManipulator.manipulate as unknown as jest.Mock;

/** Minimal stand-in for the chainable ImageManipulatorContext. */
function makeCtx(width: number, height: number, savedUri = 'file:///out.jpg') {
  const saveAsync = jest.fn().mockResolvedValue({ uri: savedUri, width, height });
  const resize = jest.fn();
  const ctx: any = {
    resize,
    renderAsync: jest.fn().mockResolvedValue({ width, height, saveAsync }),
  };
  resize.mockReturnValue(ctx);
  return { ctx, resize, saveAsync };
}

describe('compressProofImage', () => {
  afterEach(() => manipulate.mockReset());

  it('passes through empty and remote URIs untouched', async () => {
    await expect(compressProofImage(null)).resolves.toBeNull();
    await expect(
      compressProofImage('https://cdn.example.com/proof.jpg'),
    ).resolves.toBe('https://cdn.example.com/proof.jpg');
    await expect(compressProofImage('signature_placeholder')).resolves.toBe(
      'signature_placeholder',
    );
    expect(manipulate).not.toHaveBeenCalled();
  });

  it('recompresses without resizing when already under the ceiling', async () => {
    const { ctx, resize, saveAsync } = makeCtx(1200, 900);
    manipulate.mockReturnValue(ctx);
    await expect(compressProofImage('file:///in.jpg')).resolves.toBe('file:///out.jpg');
    expect(resize).not.toHaveBeenCalled();
    expect(saveAsync).toHaveBeenCalledWith({ compress: 0.8, format: 'jpeg' });
  });

  it('resizes on the LONG edge for a landscape capture', async () => {
    const { ctx, resize } = makeCtx(4032, 3024);
    manipulate.mockReturnValue(ctx);
    await compressProofImage('file:///in.jpg');
    expect(resize).toHaveBeenCalledWith({ width: PROOF_MAX_EDGE });
  });

  it('resizes on the LONG edge for a portrait capture', async () => {
    const { ctx, resize } = makeCtx(3024, 4032);
    manipulate.mockReturnValue(ctx);
    await compressProofImage('file:///in.jpg');
    expect(resize).toHaveBeenCalledWith({ height: PROOF_MAX_EDGE });
  });

  it('falls back to the original URI when the manipulator throws', async () => {
    manipulate.mockImplementation(() => {
      throw new Error('native module missing');
    });
    await expect(compressProofImage('file:///in.jpg')).resolves.toBe('file:///in.jpg');
  });
});
