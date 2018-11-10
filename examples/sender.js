var SX127x = require('../index'); // or require('sx127x')

var sx127x = new SX127x({
  frequency: 915e6
});

var count = 0;

// open the device
sx127x.open();

// send a message every second
setInterval(function() {
  console.log('write: hello ' + count);
  try {
    sx127x.write(new Buffer('hello ' + count++));
    console.log('\t', 'success');
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
