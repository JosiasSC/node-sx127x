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

// IRQ masks
var IRQ_PAYLOAD_CRC_ERROR_MASK = 0x20;

class SX127x extends events.EventEmitter {

  constructor (options) {
    super();
    this._spiBus = options.spiBus || 0;
    this._spiDevice = options.spiDevice || 0;
    this._resetPin = options.resetPin || 24;
    this._dio0Pin = options.dio0Pin || 25;
    this._frequency = options.frequency || 915e6;
    this._spreadingFactor = options.spreadingFactor || 12;  // quanto menor, mais rápido e menor a distância, o inverso é verdadeiro
    this._signalBandwidth = options.signalBandwidth || 125E3;
    this._codingRate = options.codingRate || (4 / 5);
    this._preambleLength = options.preambleLength || 8; // estava 8, porém lendo a documentação parecia que 12 seria o default.
    this._syncWord = options.syncWord || 0x12;
    this._txPower = options.txPower || 17;
    this._crc = options.crc || false;
    this._implicitHeaderMode = false;
  }

  open () {
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

    this._reset();

    var version = this.readVersion();

    if (version != 0x12) {
      throw new Error('Invalid version ' + version + ', expected 0x12');
    }

    this.sleep();
    this.setFrequency(this._frequency);
    this.setSpreadingFactor(this._spreadingFactor);
    this.setSignalBandwidth(this._signalBandwidth);
    this.setCodingRate(this._codingRate);
    this.setPreambleLength(this._preambleLength);
    this.setSyncWord(this._syncWord);
    this._writeRegister(REG_FIFO_TX_BASE_ADDR, 0);
    this._writeRegister(REG_FIFO_RX_BASE_ADDR, 0);
    this.setLnaBoost(true);
    // auto AGC
    this._writeRegister(REG_MODEM_CONFIG_3, 0x04);
    this.setTxPower(this._txPower);
    this.idle();

    this._dio0Gpio.on("interrupt", this._onDio0Rise.bind(this));
    //this._dio0Gpio.watch(this._onDio0Rise.bind(this));
  }

  close () {
    this._spi.closeSync();

    this._spi = null;

    this._dio0Gpio.disableInterrupt();
    this._dio0Gpio = null;
    this._resetGpio = null;
  }

  readVersion () {
    return this._readRegister(REG_VERSION);
  }

  setFrequency (frequency) {
    this._frequency = frequency;

    var frequencyBuffer = Buffer.alloc(4);

    var frf = ( frequency * Math.pow(2, 19) ) / 32e6;

    frequencyBuffer.writeInt32BE(Math.floor(frf));
       
    this._writeRegister(REG_FR_MSB, frequencyBuffer[1]);
    this._writeRegister(REG_FR_MID, frequencyBuffer[2]);
    this._writeRegister(REG_FR_LSB, frequencyBuffer[3]);
  }

  setLnaBoost (boost) {
    var lna = this._readRegister(REG_LNA);
    if (boost) {
      lna |= 0x03;
    } else {
      lna &= 0xfc;
    }

    this._writeRegister(REG_LNA, lna);
  }

  setTxPower (level) {
    if (level < 2) {
      level = 2;
    } else if (level > 17) {
      level = 17;
    }

    this._txPower = level;

    this._writeRegister(REG_PA_CONFIG, PA_BOOST | (level - 2));
  }

  setSpreadingFactor (sf) {
    if (sf < 6) {
      sf = 6;
    } else if (sf > 12) {
      sf = 12;
    }

    this._spreadingFactor = sf;

    var detectionOptimize = (sf === 6) ? 0xc5 : 0xc3;
    var detectionThreshold = (sf === 6) ? 0x0c : 0x0a;

    this._writeRegister(REG_DETECTION_OPTIMIZE, detectionOptimize);
    this._writeRegister(REG_DETECTION_THRESHOLD, detectionThreshold);

    var regModemConfig2 = this._readRegister(REG_MODEM_CONFIG_2);

    regModemConfig2 &= 0x0f;
    regModemConfig2 |= (sf << 4);

    this._writeRegister(REG_MODEM_CONFIG_2, regModemConfig2);
  }

  setSignalBandwidth (sbw) {
    var bw;

    if (sbw <= 7.8E3) {
      bw = 0;
    } else if (sbw <= 10.4E3) {
      bw = 1;
    } else if (sbw <= 15.6E3) {
      bw = 2;
    } else if (sbw <= 20.8E3) {
      bw = 3;
    } else if (sbw <= 31.25E3) {
      bw = 4;
    } else if (sbw <= 41.7E3) {
      bw = 5;
    } else if (sbw <= 62.5E3) {
      bw = 6;
    } else if (sbw <= 125E3) {
      bw = 7;
    } else if (sbw <= 250E3) {
      bw = 8;
    } else /*if (sbw <= 250E3)*/ {
      bw = 9;
    }

    this._signalBandwidth = sbw;

    var regModemConfig1 = this._readRegister(REG_MODEM_CONFIG_1);
    regModemConfig1 &= 0x0f;
    regModemConfig1 |= (bw << 4);

    this._writeRegister(REG_MODEM_CONFIG_1, regModemConfig1);
  }

  setCodingRate (cr) {
    var denominator;

    if (cr <= (4/5)) {
      denominator = 5;
    } else if (cr <= (4/6)) {
      denominator = 6;
    } else if (cr <= (4/7)) {
      denominator = 7;
    } else /*if (cr <= (4/8))*/ {
      denominator = 8;
    }

    this._codingRate = (4 / denominator);

    cr = denominator - 4;

    var regModemConfig1 = this._readRegister(REG_MODEM_CONFIG_1);
    regModemConfig1 &= 0xf1;
    regModemConfig1 |= (cr << 1);

    this._writeRegister(REG_MODEM_CONFIG_1, regModemConfig1);
  }

  setPreambleLength (length) {
    var lengthBuffer = Buffer.alloc(2);

    this._preambleLength = length;

    lengthBuffer.writeUInt16BE(length, 0);

    this._writeRegister(REG_PREAMBLE_MSB, lengthBuffer[0]);
    this._writeRegister(REG_PREAMBLE_LSB, lengthBuffer[1]);
  }

  setSyncWord (sw) {
    this._syncWord = sw;

    this._writeRegister(REG_SYNC_WORD, sw);
  }

  setCrc (crc) {
    this._crc = crc;

    var regModemConfig2 = this._readRegister(REG_MODEM_CONFIG_2);
    if (crc) {
      regModemConfig2 |= 0x04;
    } else {
      regModemConfig2 &= 0xfb;
    }

    this._writeRegister(REG_MODEM_CONFIG_2, regModemConfig2);
  }

  readRandom () {
    return this._readRegister(REG_RSSI_WIDEBAND);
  }

  sleep () {
    this._writeRegister(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_SLEEP);
  }

  idle () {
    this._writeRegister(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_STDBY);
  }

  receive () {
    this._writeRegister(REG_PAYLOAD_LENGTH, 1);
    // this._writeRegister(REG_IRQ_FLAGS, 0xff);
    this._dio0Gpio.enableInterrupt(Gpio.RISING_EDGE);
    this._writeRegister(REG_DIO_MAPPING_1, 0x00);
    this._writeRegister(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_RX_CONTINUOUS);
  }

  write (data) {
    this._inWrite = true;
    this.idle();
    // this.setCrc(this._crc);
    this._writeRegister(REG_FIFO_ADDR_PTR, 0);
    this._writeRegister(REG_PAYLOAD_LENGTH, data.length);
    this._writeRegFifo(data);
    this._writeRegister(REG_DIO_MAPPING_1, 0x40);
    this._dio0Gpio.enableInterrupt(Gpio.RISING_EDGE);
    this._writeRegister(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_TX);
  }

  channelActivityDetection () {
    this._inCad = true;
    this._inWrite = false;
    this.idle();
    this._writeRegister(REG_DIO_MAPPING_1, 0x80);
    this._dio0Gpio.enableInterrupt(Gpio.RISING_EDGE);
    this._writeRegister(REG_OP_MODE, MODE_LONG_RANGE_MODE | MODE_CAD);
  }

  _reset () {
    this._resetGpio.digitalWrite(0);
    sleep.usleep(100);
    this._resetGpio.digitalWrite(1);
    sleep.msleep(5);
  }

  _readRegister (register) {
    var readMessage = {
      sendBuffer: Buffer.from([register & 0x7f, 0x00]),
      receiveBuffer: Buffer.alloc(2),
      byteLength: 2
    };
    this._spi.transferSync([readMessage]);
    var result = readMessage.receiveBuffer.readUInt8(1);
    // console.log("_readRegister(): register: " + register + " result: " + result);
    return result;
  }

  _readRegisterBytes (register, length) {
    var sendBuffer = Buffer.concat([
      Buffer.from([register & 0x7f]),
      Buffer.alloc(length)
    ]);

    var readMessage = {
      sendBuffer: sendBuffer,
      receiveBuffer: Buffer.alloc(sendBuffer.length),
      byteLength: sendBuffer.length
    };
    this._spi.transferSync([readMessage]);
    return readMessage.receiveBuffer.slice(1);
  }

  _writeRegFifo (value) {
    for (var i = 0; i < value.length; i++) {
      this._readRegister(REG_FIFO_ADDR_PTR);
      this._writeRegister(REG_FIFO,value[i]);
    }
  }

  _writeRegister (register, value) {
    // console.log("_writeRegister(): register: " + register + " value: " + value);
    var sendBuffer;

    if (Buffer.isBuffer(value)) {
      sendBuffer = Buffer.concat([
        Buffer.from([register | 0x80]),
        value
      ]);
    } else {
      sendBuffer = Buffer.from([register | 0x80, value]);
    }

    var writeMessage = {
      sendBuffer: sendBuffer,
      byteLength: sendBuffer.length
    };

    this._spi.transferSync([writeMessage]);
  }

  _onDio0Rise (value) {
    console.log("_onDio0Rise(): value: " + value);
    if (value === 0) {
      return;
    }

    if (this._inWrite) {
      this._dio0Gpio.disableInterrupt();
      this._writeRegister(REG_IRQ_FLAGS, 0xff);
      this._inWrite = false;      
    } else if (this._inCad) {
      var irqs = this._readRegister(REG_IRQ_FLAGS);
      console.log("detectou!! irqs: " + irqs);
      this._writeRegister(REG_IRQ_FLAGS, 0xff);
    } else {
      var event = {};

      var irqFlags = this._readRegister(REG_IRQ_FLAGS);
      event.irqFlags = irqFlags;
      this._writeRegister(REG_IRQ_FLAGS, irqFlags);

      var rxAddr = this._readRegister(REG_FIFO_RX_CURRENT_ADDR);
      this._writeRegister(REG_FIFO_ADDR_PTR, rxAddr);

      var nbBytes = this._readRegister(this._implicitHeaderMode ? REG_PAYLOAD_LENGTH : REG_RX_NB_BYTES);
      var data = this._readRegisterBytes(REG_FIFO, nbBytes);
      event.data = data;

      var rssi = this._readRegister(REG_PKT_RSSI_VALUE);
      event.rssi = rssi - (this._frequency < 868E6 ? 164 : 157);

      var snr = this._readRegister(REG_PKT_SNR_VALUE);
      event.snr = (Buffer.from([snr])).readInt8() * 0.25;

      this._writeRegister(REG_FIFO_ADDR_PTR, 0x00);

      if ((event.irqFlags & 0x20) === 0) {
        this.emit('data', event.data, event.rssi, event.snr);
      }
    }
  }
}

module.exports = SX127x;
