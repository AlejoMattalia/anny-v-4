import { prepareVisionUpload } from '../src/lib/vision-upload';
import { analyzeVisualImage } from '../src/lib/visual-analysis';
import { ImageManipulator } from 'expo-image-manipulator';

const mockDelete = jest.fn();
const mockSave = jest.fn();
const mockOriginal = { width: 4000, height: 3000, release: jest.fn() };
const mockRendered = { saveAsync: mockSave, release: jest.fn() };
const mockContext = { renderAsync: jest.fn(), resize: jest.fn(), reset: jest.fn(), release: jest.fn() };
const mockManipulate = ImageManipulator.manipulate as jest.Mock;
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: { manipulate: jest.fn() }, SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-file-system', () => ({ File: function () { return { delete: mockDelete }; } }));
const data = (bytes: number) => 'data:image/jpeg;base64,' + Buffer.alloc(bytes).toString('base64');
const saved = (bytes: number) => ({ base64: Buffer.alloc(bytes).toString('base64'), uri: 'file:///cache/upload.jpg' });

beforeEach(() => {
  jest.clearAllMocks();
  mockManipulate.mockReturnValue(mockContext);
  mockOriginal.width = 4000; mockOriginal.height = 3000;
  mockContext.reset.mockReturnValue(mockContext);
  mockContext.resize.mockReturnValue(mockContext);
  mockContext.renderAsync.mockReset().mockResolvedValue(mockRendered).mockResolvedValueOnce(mockOriginal);
  mockSave.mockReset().mockResolvedValue(saved(100000));
});
afterEach(() => { jest.restoreAllMocks(); });

it('keeps small lens frames unchanged without running the native image processor', async () => {
  const frame = data(60000);
  expect(await prepareVisionUpload(frame, 'scan')).toBe(frame);
  expect(await prepareVisionUpload(frame, 'stream')).toBe(frame);
  expect(mockManipulate).not.toHaveBeenCalled();
});

it('reduces a multi-megabyte phone photo and keeps its aspect ratio', async () => {
  const original = data(2500000);
  const result = await prepareVisionUpload(original, 'scan');
  expect(result).toBe(data(100000));
  expect(mockContext.resize).toHaveBeenCalledWith({ width: 2048, height: 1536 });
  expect(mockSave).toHaveBeenCalledWith({ base64: true, compress: 0.82, format: 'jpeg' });
  expect(mockDelete).toHaveBeenCalledTimes(1);
  expect(mockOriginal.release).toHaveBeenCalled();
  expect(mockRendered.release).toHaveBeenCalled();
  expect(mockContext.release).toHaveBeenCalled();
});

it('uses a smaller portrait frame for streaming', async () => {
  mockOriginal.width = 3000; mockOriginal.height = 4000;
  await prepareVisionUpload(data(800000), 'stream');
  expect(mockContext.resize).toHaveBeenCalledWith({ width: 960, height: 1280 });
  expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ compress: 0.72 }));
});
it('reduces automatic navigation frames more than text-reading frames to shorten uploads', async () => {
  await prepareVisionUpload(data(800000), 'stream-fast');
  expect(mockContext.resize).toHaveBeenCalledWith({ width: 960, height: 720 });
  expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ compress: 0.65 }));
});

it('reduces again when detailed images still exceed the upload budget', async () => {
  mockSave.mockResolvedValueOnce(saved(1100000)).mockResolvedValueOnce(saved(850000));
  expect(await prepareVisionUpload(data(2500000), 'scan')).toBe(data(850000));
  expect(mockContext.resize).toHaveBeenNthCalledWith(2, { width: 1536, height: 1152 });
  expect(mockDelete).toHaveBeenCalledTimes(2);
});

it('fails locally after bounded attempts instead of uploading an oversized image', async () => {
  mockSave.mockResolvedValue(saved(1100000));
  await expect(prepareVisionUpload(data(2500000), 'scan')).rejects.toThrow('demasiado grande');
  expect(mockSave).toHaveBeenCalledTimes(3);
  expect(mockDelete).toHaveBeenCalledTimes(3);
  expect(mockContext.release).toHaveBeenCalled();
});

it('releases native resources when decoding fails', async () => {
  mockContext.renderAsync.mockReset().mockRejectedValue(new Error('Invalid JPEG'));
  await expect(prepareVisionUpload(data(2500000), 'scan')).rejects.toThrow('Invalid JPEG');
  expect(mockContext.release).toHaveBeenCalled();
});

it('sends the compressed scanner image as a multipart request below the proxy limit', async () => {
  const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, text: async () => JSON.stringify({ description: 'Un rectángulo rojo.' }) } as Response);
  expect(await analyzeVisualImage(data(2500000), 'describe_scene')).toBe('Un rectángulo rojo.');
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toContain('/v1/images/describe');
  expect((options?.body as ArrayBuffer).byteLength).toBeLessThan(1024 * 1024);
  expect((options?.body as ArrayBuffer).byteLength).toBeGreaterThan(100000);
});
