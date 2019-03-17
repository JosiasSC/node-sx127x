var SX127x = require('../index'); // or require('sx127x')

var sx127x = new SX127x({
  frequency: 433e6,
  crc: true
});

var count = 0;

// open the device
sx127x.open();
console.log('open', 'success');

// send a message every second
setInterval(function() {
  var data = 'hello ' + count++;
  data += " | length: " + data.length; 
  console.log("data", data);
  try {
    sx127x.write(Buffer.from(data));
  } catch (err) {
    console.log('\t', err);
  }
}, 1000);

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