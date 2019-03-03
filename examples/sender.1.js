const events = require('events');

//var onoff = require('onoff');
const Gpio = require('pigpio').Gpio;

const spi = require('spi-device');
const sleep = require('sleep');

var SPI_OPTIONS = {
  mode: spi.MODE0,
  maxSpeedHz: 12E6
};

// registers
var REG_FIFO                   = 0x00;
var REG_OP_MODE                = 0x01;
var REG_FR_MSB                 = 0x06;
var REG_FR_MID                 = 0x07;
var REG_FR_LSB                 = 0x08;
var REG_PA_CONFIG              = 0x09;
var REG_LNA                    = 0x0c;
var REG_FIFO_ADDR_PTR          = 0x0d;
var REG_FIFO_TX_BASE_ADDR      = 0x0e;
var REG_FIFO_RX_BASE_ADDR      = 0x0f;
var REG_FIFO_RX_CURRENT_ADDR   = 0x10;
var REG_IRQ_FLAGS              = 0x12;
var REG_RX_NB_BYTES            = 0x13;
var REG_PKT_RSSI_VALUE         = 0x1a;
var REG_PKT_SNR_VALUE          = 0x1b;
var REG_MODEM_CONFIG_1         = 0x1d;
var REG_MODEM_CONFIG_2         = 0x1e;
var REG_PREAMBLE_MSB           = 0x20;
var REG_PREAMBLE_LSB           = 0x21;
var REG_PAYLOAD_LENGTH         = 0x22;
var REG_MODEM_CONFIG_3         = 0x26;
var REG_RSSI_WIDEBAND          = 0x2c;
var REG_DETECTION_OPTIMIZE     = 0x31;
var REG_DETECTION_THRESHOLD    = 0x37;
var REG_SYNC_WORD              = 0x39;
var REG_DIO_MAPPING_1          = 0x40;
var REG_VERSION                = 0x42;

// modes
var MODE_LONG_RANGE_MODE       = 0x80;
var MODE_SLEEP                 = 0x00;
var MODE_STDBY                 = 0x01;
var MODE_TX                    = 0x03;
var MODE_RX_CONTINUOUS         = 0x05;
var MODE_CAD                   = 0x07;

// PA config
var PA_BOOST                   = 0x80;

this._dio0Pin = 25;
this._resetPin = 24;
this._spiBus = 0;
this._spiDevice = 0;

this._dio0Gpio = new Gpio(
  this._dio0Pin, 
  {
    mode: Gpio.INPUT, 
    pullUpDown: Gpio.PUD_DOWN,
    edge: Gpio.RISING_EDGE 
  }); //new onoff.Gpio(this._dio0Pin, 'in', 'rising');
this._resetGpio = new Gpio(
  this._resetPin,
  {
    mode: Gpio.OUTPUT
  }
);//new onoff.Gpio(this._resetPin, 'out');

this._spi = spi.openSync(this._spiBus, this._spiDevice, SPI_OPTIONS);

this._resetGpio.digitalWrite(0);
sleep.usleep(100);
this._resetGpio.digitalWrite(1);
sleep.msleep(5);

this._readRegister = function (register) {
  var readMessage = {
    sendBuffer: Buffer.from([register & 0x7f, 0x00]),
    receiveBuffer: Buffer.alloc(2),
    byteLength: 2
  };
  this._spi.transferSync([readMessage]);
  var result = readMessage.receiveBuffer.readUInt8(1);
  console.log("_readRegister(): register: " + register + " result: " + result);
  return result;
}

this._writeRegister = function (register, value) {

  console.log("_writeRegister(): register: " + register + " value: " + value);

  var sendBuffer = Buffer.from([register | 0x80, value]);

  var writeMessage = {
    sendBuffer: sendBuffer,
    byteLength: sendBuffer.length
  };

  this._spi.transferSync([writeMessage]);
}

this._readRegister(REG_VERSION);

//sleep
//var aux = this._readRegister(REG_OP_MODE);
this._writeRegister(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_SLEEP);

this._onDio0Rise = function (value) {
  var irqs = this._readRegister(REG_IRQ_FLAGS);
  var opmode = this._readRegister(REG_OP_MODE);
  console.log("Interrupt: value: " + value + " irqs: " + irqs + " opmode: " + opmode);
}

this._dio0Gpio.on("interrupt", this._onDio0Rise.bind(this));

this._writeRegister(REG_DIO_MAPPING_1, 0x40);

this._dio0Gpio.enableInterrupt(Gpio.RISING_EDGE);

for (var i = 0; i < 255; i++) {
  this._writeRegister(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_STDBY);
  this._writeRegister(REG_FIFO_ADDR_PTR, 0);
  this._writeRegister(REG_PAYLOAD_LENGTH, 1);
  this._writeRegister(REG_FIFO, i);
  this._writeRegister(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_TX);
  sleep.msleep(1000);
}

/*

var count = 0;

// open the device
sx127x.open();

// send a message every second
setInterval(function() {
  console.log('write: hello ' + count);
  try {
    sx127x.write(Buffer.from('hello ' + count++));
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
*/