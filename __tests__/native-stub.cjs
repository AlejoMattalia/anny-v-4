/* global jest */
module.exports = {
  NativeModules: {},
  Platform: { OS: 'ios', Version: 31 },
  PermissionsAndroid: {
    PERMISSIONS: { ACCESS_FINE_LOCATION: 'location', BLUETOOTH_SCAN: 'scan', BLUETOOTH_CONNECT: 'connect' },
    RESULTS: { GRANTED: 'granted' },
    check: jest.fn().mockResolvedValue(true),
    request: jest.fn().mockResolvedValue('granted'),
    requestMultiple: jest.fn().mockResolvedValue({scan: 'granted', connect: 'granted'}),
  },
};
