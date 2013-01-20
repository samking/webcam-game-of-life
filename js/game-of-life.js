/**
 * Shadowboxing: CS 247 P2
 * -----------------------
 * Questions go to Piazza: https://piazza.com/stanford/winter2013/cs247/home
 * Performs background subtraction on a webcam or kinect driver to identify
 * body outlines. Relies on HTML5: <video> <canvas> and getUserMedia().
 * Feel free to configure the constants below to your liking.
 * 
 * Created by Michael Bernstein 2013
 *
 * This file does the game of life on a person's shadow.  The code started from
 * the CS247 shadowboxing.js file.
 */

// Student-configurable options below...

// show the after-gaussian blur camera input
SHOW_RAW = false;
// show the final shadow
SHOW_SHADOW = true;
// input option: kinectdepth (kinect depth sensor), kinectrgb (kinect camera), 
// or webcam (computer camera)
var INPUT = "webcam"; 
// A difference of >= SHADOW_THRESHOLD across RGB space from the background
// frame is marked as foreground
var SHADOW_THRESHOLD = 10;
// Between 0 and 1: how much memory we retain of previous frames.
// In other words, how much we let the background adapt over time to more recent frames
var BACKGROUND_ALPHA = 0.05;
// We run a gaussian blur over the input image to reduce random noise 
// in the background subtraction. Change this radius to trade off noise for precision 
var STACK_BLUR_RADIUS = 10; 

var WIDTH = 640;
var HEIGHT = 480;


/*
 * Begin shadowboxing code
 */
var mediaStream, video, rawCanvas, rawContext, shadowCanvas, shadowContext, background = null;
var kinect, kinectSocket = null;

var started = false;

var gameOfLifePx = null;

$(document).ready(function() {
    initializeDOMElements();

    $("#background").attr('disabled', true);
    if (INPUT == "kinectdepth" || INPUT == "kinectrgb") {
        setUpKinect();
    } else if (INPUT == "webcam") {
        setUpWebCam();
    }

    $('#background').click(function() {
        setBackground();
        if (!started) {
            renderShadow();
        }
    });
});

/*
 * Creates the video and canvas elements
 */
function initializeDOMElements() {
    video = document.createElement('video');
    video.setAttribute('autoplay', true);
    video.style.display = 'none';
    
    rawCanvas = document.createElement('canvas');
    rawCanvas.setAttribute('id', 'rawCanvas');
    rawCanvas.setAttribute('width', WIDTH);
    rawCanvas.setAttribute('height', HEIGHT);
    rawCanvas.style.display = SHOW_RAW ? 'block' : 'none';
    document.getElementById('capture').appendChild(rawCanvas);
    rawContext = rawCanvas.getContext('2d');
    // mirror horizontally, so it acts like a reflection
    rawContext.translate(rawCanvas.width, 0);
    rawContext.scale(-1,1);    
    
    shadowCanvas = document.createElement('canvas');
    shadowCanvas.setAttribute('id', 'shadowCanvas');
    shadowCanvas.setAttribute('width', WIDTH);
    shadowCanvas.setAttribute('height', HEIGHT);
    shadowCanvas.style.display = SHOW_SHADOW ? 'block' : 'none';
    document.getElementById('capture').appendChild(shadowCanvas);
    shadowContext = shadowCanvas.getContext('2d');    
}


/*
 * Starts the connection to the Kinect
 */
function setUpKinect() {
    kinect.sessionPersist()
          .modal.make('css/knctModal.css')
          .notif.make();
          
    kinect.addEventListener('openedSocket', function() {
        startKinect();
    });
}

/*
 * Starts the socket for depth or RGB messages from KinectSocketServer
 */
function startKinect() {
    if (INPUT != "kinectdepth" && INPUT != "kinectrgb") {
        console.log("Asking for incorrect socket from Kinect.");
        return;
    }
    
    if(kinectSocket)
    {
        kinectSocket.send( "KILL" );
        setTimeout(function() {
            kinectSocket.close();
            kinectSocket.onopen = kinectSocket.onmessage = kinectSocket = null;
        }, 300 );
        return false;
    }
    
    // Web sockets
    if (INPUT == "kinectdepth") {
        kinectSocket = kinect.makeDepth(null, true, null);
    } else if (INPUT == "kinectrgb") {
        kinectSocket = kinect.makeRGB(null, true, null);
    }

    kinectSocket.onopen = function() {
    };
    
    kinectSocket.onclose = kinectSocket.onerror = function() {
        kinectSocket.onclose = kinectSocket.onerror = null;
        return false;
    };

    kinectSocket.onmessage = function( e ) {
        if (e.data.indexOf("data:image/jpeg") == 0) {
            var image = new Image();
            image.src = e.data;
            image.onload = function() {
                rawContext.drawImage(image, 0, 0, 640, 480);
            }
            return false;
        }
    };
}

/*
 * Starts webcam capture
 */
function setUpWebCam() {
    navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
    if (!navigator.getUserMedia) { 
        console.log("Browser does not support getUserMedia. Try a latest version of Chrome/Firefox");
    }
    window.URL = window.URL || window.webkitURL;
    
    video.addEventListener('canplay', function() {
        if ($('#background').attr('disabled')) {
            $('#background').attr('disabled', false);
        }
    }, false);
    
    var failVideoStream = function(e) {
      console.log('Failed to get video stream', e);
    };
    
    navigator.getUserMedia({video: true, audio:false}, function(stream) {
        mediaStream = stream;
        
        if (navigator.mozGetUserMedia) {
          video.mozSrcObject = stream;
          video.play();
        } else {
          video.src = window.URL.createObjectURL(stream);
        }        
      }, failVideoStream);
}

/*
 * Gets an array of the screen pixels. The array is 4 * numPixels in length,
 * with [red, green, blue, alpha] for each pixel.
 */
function getCameraData() {
    if (mediaStream || kinect) {
        rawContext.drawImage(video, 0, 0, rawCanvas.width, rawCanvas.height);
        stackBlurCanvasRGB('rawCanvas', 0, 0, rawCanvas.width, rawCanvas.height, STACK_BLUR_RADIUS);        
        var pixelData = rawContext.getImageData(0, 0, rawCanvas.width, rawCanvas.height);
        return pixelData;
    }    
}

/*
 * Remembers the current pixels as the background to subtract.
 */
function setBackground() {
    var pixelData = getCameraData();
    background = pixelData;
}

/*
 * Returns an ImageData object that contains black pixels for the shadow
 * and white pixels for the background
 */

function getShadowData() {
    var pixelData = getCameraData();

    // Each pixel gets four array indices: [r, g, b, alpha]
    for (var i=0; i<pixelData.data.length; i=i+4) {
        var rCurrent = pixelData.data[i];
        var gCurrent = pixelData.data[i+1];
        var bCurrent = pixelData.data[i+2];
        
        var rBackground = background.data[i];
        var gBackground = background.data[i+1];
        var bBackground = background.data[i+2];
                
        var distance = pixelDistance(rCurrent, gCurrent, bCurrent, rBackground, gBackground, bBackground);        
        
        if (distance >= SHADOW_THRESHOLD) {
            // foreground, show shadow
            pixelData.data[i] = 0;
            pixelData.data[i+1] = 0;
            pixelData.data[i+2] = 0;
        } else {
            // background
            
            //  update model of background, since we think this is in the background
            updateBackground(i, rCurrent, gCurrent, bCurrent, rBackground, gBackground, bBackground);
            
            // now set the background color
            pixelData.data[i] = 255;
            pixelData.data[i+1] = 255;
            pixelData.data[i+2] = 255;
            pixelData.data[i+3] = 0;
        }        
    }
    
    return pixelData; 
}

function updateBackground(i, rCurrent, gCurrent, bCurrent, rBackground, gBackground, bBackground) {
    background.data[i] = Math.round(BACKGROUND_ALPHA * rCurrent + (1-BACKGROUND_ALPHA) * rBackground);
    background.data[i+1] = Math.round(BACKGROUND_ALPHA * gCurrent + (1-BACKGROUND_ALPHA) * gBackground);
    background.data[i+2] = Math.round(BACKGROUND_ALPHA * bCurrent + (1-BACKGROUND_ALPHA) * bBackground);
}

/*
 * Returns the distance between two pixels in grayscale space
 */
function pixelDistance(r1, g1, b1, r2, g2, b2) {
    return Math.abs((r1+g1+b1)/3 - (r2+g2+b2)/3);
}

/**************************************************************
 *  BEGIN GAME OF LIFE STUFF
 *************************************************************/

/**
 * Returns the index into a pixels array of the symbolic row and column.
 */
function getPxNum(row, col) {
  // index in by row and column
  var pxNum = row * WIDTH + col;
  // every pixel has rgba
  var pxIndex = pxNum * 4;
  return pxIndex;
}

/**
 * Sets pixels[pxNum] to rgba
 */
function setColor(pixels, pxNum, r, g, b, a) {
  pixels.data[pxNum] = r;
  pixels.data[pxNum + 1] = g;
  pixels.data[pxNum + 2] = b;
  pixels.data[pxNum + 3] = a;
}

/**
 * Returns true if pixels[pxNum] is black
 */
function isBlack(pixels, pxNum) {
  return (0 == pixels.data[pxNum] == pixels.data[pxNum + 1] == 
          pixels.data[pxNum + 2]);
}

/**
 * Returns true if pixels[row][col] is within bounds and black.
 */
function isNeighborBlack(pixels, row, col) {
  // don't let row or col be out of bounds
  if (row < 0 || row > HEIGHT - 1 || col < 0 || col > WIDTH - 1) return false;
  return isBlack(pixels, getPxNum(row, col));
}

/**
 * Returns the number of neighbors pixels[row][col] has.  A neighbor can be in
 * any of 8 directions.  Assumes Pixels is an ImageData, which will be
 * represented by a 1d array that is WIDTH x HEIGHT
 */
function findNumNeighbors(pixels, row, col) {
  var numNeighbors = 0;
  for (var dRow = -1; dRow <= 1; dRow++) {
    for (var dCol = -1; dCol <= 1; dCol++) {
      // don't do anything if we're looking at the current row and col
      if (dRow != 0 || dCol != 0) {
        if (isNeighborBlack(pixels, row + dRow, col + dCol)) {
          numNeighbors++;
        }
      }
    }
  }
  return numNeighbors;
}

/**
 * Performs one round of the Game of Life on gameOfLifePx
 */
function doGameOfLifeRound() {
  if (gameOfLifePx == null) return;
  nextRound = makeNewPixels(false);
  for (var row = 0; row < HEIGHT; row++) {
    for (var col = 0; col < WIDTH; col++) {
      numNeighbors = findNumNeighbors(gameOfLifePx, row, col);
      // To live, there should be 2 or 3 neighbors
      if (numNeighbors == 2 || numNeighbors == 3) {
        setColor(nextRound, getPxNum(row, col), 0, 0, 0, 255);
      } else {
        setColor(nextRound, getPxNum(row, col), 255, 255, 255, 255);
      }
    }
  }
  gameOfLifePx = nextRound;
}

function makeNewPixels(initialize) {
  newPx = shadowContext.createImageData(WIDTH, HEIGHT);
  if (initialize) {
    // white out everything for our blank canvas
    for (var pxNum = 0; pxNum < newPx.data.length; pxNum += 4) {
      setColor(newPx, pxNum, 255, 255, 255, 255);
    }
  }
  return newPx;
}

/**
 *  Adds every pixel in the shadow to the game of life pixels.
 */ 
function addShadowToLife(shadowPx) {
  if (gameOfLifePx == null) {
    gameOfLifePx = makeNewPixels(true);
  } else {
    // foreach pixel in shadowPx 
    // pixels are stored as RGBA, so we need to go by 4 each time
    for (var pxNum = 0; pxNum < gameOfLifePx.data.length; pxNum += 4) {
      // if pixel is black:
      if (isBlack(shadowPx, pxNum)) {
        // set the corresponding pixel to black in gameOfLifePx
        setColor(gameOfLifePx, pxNum, 0, 0, 0, 255);
      }
    }
  }
}

/*
 * In a loop: gets the current frame of video, thresholds it to the background frames,
 * and outputs the difference as a shadow.
 */
function renderShadow() {
  if (!background) {
    return;
  }
  
  pixelData = getShadowData();
  // Run one round of the Game of Life using last round's game of life pixels
  doGameOfLifeRound();
  // Make sure that all shadow pixels stay shadowy
  addShadowToLife(pixelData);
  // display the game of life modified image
  shadowContext.putImageData(gameOfLifePx, 0, 0);
  // shadowContext.putImageData(pixelData, 0, 0);
  setTimeout(renderShadow, 0);
}
