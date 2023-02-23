import { createServer } from 'node:http';
import crypto from 'crypto';

const PORT = 9000;

// websockets magic string
// source : https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API/Writing_WebSocket_servers#client_handshake_request
const WEBSOCKET_MAGIC_STRING = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


const MASK_BIT = 128;
const MARK_KEY_BYTES_LENGTH = 4;
const SEVEN_BITS_INTEGER_MARKER = 125 // as byte: 01111101
const SIXTEEN_BITS_INTEGER_MARKER = 126 // as byte: 01111110
const SIXTYFOUR_BITS_INTEGER_MARKER = 127 // as byte: 01111111
const MAXIMUM_SIXTEEN_BITS_INTEGER = 2 ** 16;
const OPCODE_TEXT = 0x01;


const server = createServer((req, res) => {
    res.writeHead(200);
    res.end('hello there')
})
    .listen(PORT, () => console.log('Server listening on port', PORT));

function onSocketUpgrade(req, socket, head) {
    // gets the client generated websocket key
    const { 'sec-websocket-key': clientWebSocketKey } = req.headers;
    const response = prepareHandshakeResponse(clientWebSocketKey);
    socket.write(response);

    socket.on('readable', () => onSocketReadable(socket));
}

function onSocketReadable(socket) {
    // ignote first byte
    socket.read(1)

    // second byte indicates the MASK and payload lenght
    const [maskAndPayloadLength] = socket.read(1)

    const lengthInBits = maskAndPayloadLength - MASK_BIT;
    let messageLength = 0

    if (lengthInBits <= SEVEN_BITS_INTEGER_MARKER) {
        messageLength = lengthInBits;
    } else if(lengthInBits === SIXTEEN_BITS_INTEGER_MARKER) {
        messageLength = socket.read(2).readUint16BE(0);
    } else {
        throw new Error('the message is too long! The server cant handle more than 125 characters in the payload.')
    }

    // get the mask key and the encoded payload
    const maskKey = socket.read(MARK_KEY_BYTES_LENGTH);
    const encoded = socket.read(messageLength);

    // bitwise XOR
    const decoded = Buffer.from(Uint8Array.from(encoded, (el, index) => el ^ maskKey[index % 4]));
    // console.log(JSON.parse(decoded));

    sendMessage(decoded, socket);
}

server.on('upgrade', onSocketUpgrade);

function sendMessage(msg, socket) {
    const msgSize = Buffer.from(msg).length;
    console.log(`msg size : ${msgSize}`);

    let dataFrameBuffer;
    // Bitwise operation
    const firstByte = 0x80 | OPCODE_TEXT;

    if(msgSize <= SEVEN_BITS_INTEGER_MARKER) {
        const bytes = [firstByte];
        dataFrameBuffer = Buffer.from(bytes.concat(msgSize));
        console.log(dataFrameBuffer);
    } else if (msgSize <= MAXIMUM_SIXTEEN_BITS_INTEGER) {
        const offsetFourBytes = 4;
        const target = Buffer.allocUnsafe(offsetFourBytes);
        target[0] = firstByte;
        target[1] = SIXTEEN_BITS_INTEGER_MARKER | 0x00;
        target.writeUint16BE(msgSize,2);
        dataFrameBuffer = target;
    } else {
        throw new Error('message is too long');
    }

    const totalLength = dataFrameBuffer.byteLength + msgSize;
    const msgBuffer = Buffer.allocUnsafe(totalLength);
    let offset = 0;

    for (const buffer of [dataFrameBuffer, msg]) {
        msgBuffer.set(buffer, offset);
        offset += buffer.length;
    }
    console.log(msgBuffer);

    socket.write(msgBuffer);
}

function prepareHandshakeResponse(id) {
    const acceptKey = createSocketAccept(id);

    return [
        'HTTP/1.1 101 Switching Protocols',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `sec-webSocket-accept: ${acceptKey}`,
        // last line must be empty
        ''
    ].map(line => line.concat('\r\n')).join(''); // every header line must end with \r\n
}


function createSocketAccept(id) {
    const hash = crypto.createHash('sha1');
    hash.update(id + WEBSOCKET_MAGIC_STRING);
    return hash.digest('base64');
}


// handling errors to keep the server up
['uncaughtException', 'unhandledRejection']
    .forEach(event => {
        process.on(event, (err) => {
            console.error(`something broke: ${event}, msg : ${err.stack || err}`)
        })
    })