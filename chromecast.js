const express = require('express')
const fs = require('fs');
const ChromecastAPI = require('chromecast-api');
const mdns = require('multicast-dns');
const WebTorrent = require('webtorrent');
const hbjs = require('handbrake-js')  // used for encoding

const app = express()

const localIp = '192.168.0.129';
const port = `8008`;

// endpoint to serve video files from /videos
app.use('/videos', express.static('./videos'))

//endpoint to display names of each file in ./videos
app.get('/library', (req, res) => {
    const files = fs.readdirSync('./videos')
    // for each file get its properties
    const fileProperties = files.map(file => {
        const stats = fs.statSync(`./videos/${file}`)
        return {
            name: file,
            //size as mb instead of bytes.
            size: (stats.size / 1000000).toFixed(2) + 'mb'
        }
    })
    res.send(fileProperties)
})

app.get('/play', (req, res) => {
    // get video file name from query string
    const fileName = req.query.fileName
    // if no filename
    if (!fileName) {
        res.send('no file name')
        return
    }
    playVideo(fileName, res);
})

app.get('/torrent', (req, res) => {
    const torrentClient = new WebTorrent();

    // get magnetLink from query params
    const magnetLink = req.query.magnetLink;
    // if magnetLink is not provided, return
    if (!magnetLink) {
        res.send('magnetLink is required');
        return;
    }
    // const magnetLink = 'magnet:?xt=urn:btih:FAE25355ACCF4B0D49EAE2A8096606DB7D437A4F&dn=Bao+%282018%29+%5BBluRay%5D+%5B720p%5D+%5BYTS%5D+%5BYIFY%5D&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969%2Fannounce&tr=udp%3A%2F%2F9.rarbg.com%3A2710%2Fannounce&tr=udp%3A%2F%2Fp4p.arenabg.com%3A1337&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce&tr=http%3A%2F%2Ftracker.openbittorrent.com%3A80%2Fannounce&tr=udp%3A%2F%2Fopentracker.i2p.rocks%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.internetwarriors.net%3A1337%2Fannounce&tr=udp%3A%2F%2Ftracker.leechers-paradise.org%3A6969%2Fannounce&tr=udp%3A%2F%2Fcoppersurfer.tk%3A6969%2Fannounce&tr=udp%3A%2F%2Ftracker.zer0day.to%3A1337%2Fannounce'

    console.log('adding torrent');
    torrentClient.on('error', err => {
        console.log(err);
    })
    torrentClient.add(magnetLink, torrent => {
        console.log(torrent);
        // every 3 seconds console progress
        const progressInterval = setInterval(() => {
            // if progress is 1, clear interval
            if (torrent.progress === 1) {
                clearInterval(progressInterval);
            }
            // torrent.progress is a number between 0 and 1, convert to %
            console.log(`Progress: ${(torrent.progress * 100).toFixed(2)}%`);
            // take torrent.timeRemaining in milliseconds and convert to minutes
            console.log(`Time remaining: ${(torrent.timeRemaining / 1000 / 60).toFixed(2)} minutes`);

        }, 3000);
        torrent.on('done', () => {
            res.send(onTorrentComplete(torrent, torrentClient));
        });
    });
})

// listen on port 8008
app.listen(8008, () => {
    console.log('listening on port 8008')
})

function onTorrentComplete(torrent, torrentClient) {
    // console log path of torrent files
    torrent.files.forEach(file => {
        console.log(file.name);
        console.log(file.path);
    })
    // find the video file which could be mkv, mp4, etc TODO: add more file types
    const videoFile = torrent.files.find(file => file.name.endsWith('.mkv') || file.name.endsWith('.mp4') || file.name.endsWith('.avi') || file.name.endsWith('.mov') || file.name.endsWith('.wmv'));

    // move file from its current location to the ./videos folder
    fs.renameSync(videoFile.path, `./videos/${videoFile.name}`);

    console.log('torrent downloaded');
    torrentClient.destroy(err => {
        if (err) {
            console.log(err);
            return;
        }
        console.log('torrent client destroyed');
    })

    return videoFile;
}


async function encodeToMp4(fileName) {
    // get filename, remove .mkv from the end and add .mp4
    const mp4FileName = fileName.replace('.mkv', '.mp4');
    console.log('converting file to mp4...');
    return await new Promise((resolve, reject) => {
        hbjs.spawn({input: `./videos/${fileName}`, output: `./videos/${mp4FileName}`})
            .on('error', err => {
                // invalid user input, no video found etc
                console.log(err);
                reject(err);
            })
            .on('progress', progress => {
                console.log(
                    'Percent complete: %s, ETA: %s',
                    progress.percentComplete,
                    progress.eta
                )
            })
            .on('end', () => {
                console.log('conversion complete');
                resolve(mp4FileName);
            })

    })


}

async function convertVideo(fileName) {
    //if filename ends with mkv, run it through encodeToMp4 function
    if (fileName.endsWith('.mkv')) {
        console.log('filename is .mkv, encoding to mp4');
        fileName = await encodeToMp4(fileName);
        console.log('fileName is now: ' + fileName);
    }
    return fileName;
}

/**
 * Plays video through Chromecast using fileName. if res is provided, will send out a response on error
 * @param fileName - name of file to play
 * @param res - response object to send error to
 */
function playVideo(fileName, res) {
    const client = new ChromecastAPI()

    client.on('device', async device => {
        console.log(device);

        const mediaURL = `http://${localIp}:${port}/videos/${fileName}`;
        // const mediaURL = `http://${localIp}:${port}/videos/test.mkv`;


        // if device friendlyName is TV
        if (device.friendlyName === 'TV') {
            // play media
            device.play(mediaURL, err => {
                if (err) {
                    console.log(err);
                    res?.send(err);
                    return;
                }
                console.log('Playing in your chromecast on device: ' + device.friendlyName)
            })
        }
    })

    const _mdns = mdns({interface: localIp})
    _mdns.query('_googlecast._tcp.local', 'PTR')
}
