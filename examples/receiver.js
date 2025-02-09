var SX127x = require('../index'); // or require('sx127x')

var sx127x = new SX127x({
  frequency: 433e6,
  crc: false,
  signalBandwidth: 500e3
});

var count = 0;

// open the device
sx127x.open();
console.log('open', 'success');

// add a event listener for data events
sx127x.on('data', function(data, length, rssi, snr) {
  console.log('data', '\'' + data.toString() + '\'', "length", length, "rssi", rssi, "snr", snr);
});

// enable receive mode
sx127x.receive();
console.log('receive', 'success');

process.on('SIGINT', function() {
  // close the device
  try {
    sx127x.close();
    console.log('close', 'success');
  } catch (err) {
    console.log('close', err);
  }
  process.exit();
});