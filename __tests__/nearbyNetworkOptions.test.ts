import {nearbyNetworkOptions} from '../src/services/nearbyNetworkOptions';

it('keeps a 5 GHz iPhone hotspot visible with its exact name and a compatibility warning', () => {
  expect(nearbyNetworkOptions([{ssid: 'Alejo’s iPhone', signal: -37, frequency: 5745}]))
    .toEqual([{ssid: 'Alejo’s iPhone', signal: -37, requires24GHz: true}]);
});

it.each([false, true])('groups dual-band networks without a warning regardless of scan order (%s)', (reverse) => {
  const radios = [
    {ssid: 'Home', signal: -60, frequency: 2412},
    {ssid: 'Home', signal: -35, frequency: 5180},
  ];
  expect(nearbyNetworkOptions(reverse ? radios.reverse() : radios))
    .toEqual([{ssid: 'Home', signal: -35, requires24GHz: false}]);
});

it('sorts by signal and does not claim incompatibility for unknown frequencies', () => {
  expect(nearbyNetworkOptions([
    {ssid: 'Far', signal: -90, frequency: 2412},
    {ssid: 'Unknown', signal: -40},
    {ssid: 'Unknown', signal: -50, frequency: 5180},
    {ssid: 'Near', signal: -20, frequency: 5975},
  ])).toEqual([
    {ssid: 'Near', signal: -20, requires24GHz: true},
    {ssid: 'Unknown', signal: -40, requires24GHz: false},
    {ssid: 'Far', signal: -90, requires24GHz: false},
  ]);
});
