'use strict';
// "Mining gear" filter: specific computer parts a miner might replace, matched on the listing title. Deliberately
// narrow: loose words like cooling, usb, fan or cable also match clothing and accessories.
const GEAR = new RegExp('\\b(' + [
  'gpu', 'cpu', 'graphics card', 'video card', 'ryzen', 'threadripper', 'epyc', 'xeon', 'core i[3579]', 'radeon', 'geforce', 'nvidia', 'rtx', 'gtx', 'rx ?[4-7]\\d{2}',
  'ssd', 'nvme', 'm\\.2', 'ddr[2345]', 'so-?dimm', 'dimm', 'motherboard', 'mainboard', 'power supply', 'psu', 'atx', 'asic', 'mining rig', 'miner', 'riser', 'pcie', 'pci-e',
  'cpu cooler', 'heat ?sink', 'thermal (?:paste|pad|pads|compound|grizzly)', 'thermal grizzly', 'aio cooler', 'case fan', 'cooling fan', 'rack'
].join('|') + ')\\b', 'i');
module.exports = { GEAR, isGear: (t) => GEAR.test(String(t || '')) };
