// 'use strict';

var CANVAS, STATS;
var SCENE, CAMERA, CAMERA_CTRL, RENDERER;
var WIDTH = window.innerWidth;
var HEIGHT = window.innerHeight;
var PIXEL_RATIO = window.devicePixelRatio || 1;
var SCREEN_RATIO = WIDTH / HEIGHT;

// ---- Settings
var SCENE_SETTINGS = {

	bgColor: 2368557,
	enableGridHelper: true,
	enableAxisHelper: true

};

// ---- Scene
CANVAS = document.getElementById( 'canvas-container' );
SCENE = new THREE.Scene();
// ---- Camera
CAMERA = new THREE.PerspectiveCamera( 40, window.innerWidth / window.innerHeight, 10, 100000 );
// CAMERA orbit control
CAMERA_CTRL = new THREE.OrbitControls( CAMERA, CANVAS );
CAMERA_CTRL.object.position.z = 600;
CAMERA_CTRL.update();

// ---- Renderer
// RENDERER = new THREE.WebGLRenderer( {
// 	antialias: true,
// 	alpha: true
// } );


RENDERER = new THREE.CSS3DRenderer();

RENDERER.setSize( WIDTH, HEIGHT );
// RENDERER.setPixelRatio( PIXEL_RATIO );
// RENDERER.setClearColor( SCENE_SETTINGS.bgColor, 1 );
// RENDERER.autoClear = false;
CANVAS.appendChild( RENDERER.domElement );

// ---- Stats
STATS = new Stats();
CANVAS.appendChild( STATS.domElement );

// ---- grid & axis helper
var gridHelper = new THREE.GridHelper( 600, 50 );
gridHelper.setColors( 48127, 16777215 );
gridHelper.material.opacity = 0.1;
gridHelper.material.transparent = true;
gridHelper.position.y = -300;
SCENE.add( gridHelper );

var axisHelper = new THREE.AxisHelper( 50 );
SCENE.add( axisHelper );

function updateHelpers() {
	gridHelper.visible = !!SCENE_SETTINGS.enableGridHelper;
	axisHelper.visible = !!SCENE_SETTINGS.enableAxisHelper;
}
updateHelpers();

//source: gui.js
var gui, gui_display, gui_settings;

function initGui() {

	// gui_settings.add( Object, property, min, max, step ).name( 'name' );
	gui = new dat.GUI();
	gui.width = 300;
	dat.GUI.toggleHide();

	gui_display = gui.addFolder( 'Display' );
	gui_display.autoListen = false;

	gui_settings = gui.addFolder( 'Settings' );

	gui_settings.addColor( SCENE_SETTINGS, 'bgColor' ).name( 'Background' );
	gui_settings.add( CAMERA, 'fov', 25, 120, 1 ).name( 'FOV' );

	gui_display.open();
	gui_settings.open();

	gui_settings.__controllers.forEach( function ( controller ) {
		controller.onChange( updateSettings );
	} );
}

function updateSettings() {

	CAMERA.updateProjectionMatrix();
	RENDERER.setClearColor( SCENE_SETTINGS.bgColor, 1 );
}

function updateGuiDisplay() {

	gui_display.__controllers.forEach( function ( controller ) {
		controller.updateDisplay();
	} );
}

//source: main.js
function main() {

	initGui();


}

// function makePosterItem( posterObject ) {
//
// 	console.log( posterObject );
// 	var elem = document.createElement( 'div' );
// 	elem.className = 'posterElem';
// 	elem.style.backgroundImage = "url('http://image.tmdb.org/t/p/w154/" + posterObject.poster_path + "')";
// 	elem.style.width = '150px';
// 	elem.style.height = '230px';
// 	elem.textContent = 'TEST TEXT';
// 	var css3dObj = new THREE.CSS3DObject( elem );
// 	SCENE.add( css3dObj );
// 	return css3dObj;
//
// }

function makeMultiPosterItem( posterObjectMulti ) {
	for ( var i = 0 ; i < posterObjectMulti.length; i ++ ) {
		var poster = makePosterItem( posterObjectMulti[ i ] );
		poster.position.setX( 200 * i );
	}
}

function makePosterItemHelix( posterObjectMulti ) {
	var vector = new THREE.Vector3();
	var allPosters = new THREE.Object3D();
	for ( var i = 0 ; i < posterObjectMulti.length; i ++ ) {
		var elem = document.createElement( 'div' );
		elem.className = 'posterElem';
		elem.style.backgroundImage = "url('http://image.tmdb.org/t/p/w154/" + posterObjectMulti[i].poster_path + "')";
		elem.style.width = '150px';
		elem.style.height = '230px';
		// elem.textContent = 'TEST TEXT';
		var css3dObj = new THREE.CSS3DObject( elem );

		var phi = i * 0.175 + Math.PI;
		var rr = 900;
		css3dObj.position.x = -rr * Math.sin( phi );
		css3dObj.position.y = -( i * 8 ) + 200;
		css3dObj.position.z = rr * Math.cos( phi );

		vector.x = -css3dObj.position.x * 2;
		vector.y = css3dObj.position.y;
		vector.z = -css3dObj.position.z * 2;
		// vector.multiplyScalar( -1 );

		css3dObj.lookAt( vector );

		allPosters.add( css3dObj );
	}
	SCENE.add( allPosters );
}

//source: run.js
function update() {

}

// ----  draw loop
function run() {

	requestAnimationFrame( run );
	// RENDERER.clear();
	update();
	RENDERER.render( SCENE, CAMERA );
	STATS.update();
}

//source: events.js
window.addEventListener( 'keypress', function ( event ) {
	switch ( event.keyCode ) {
		case 65:
			/*A*/
			break;
	}
} );

window.addEventListener( 'resize', debounce( onWindowResize, 50 ) );

function onWindowResize() {

	WIDTH = window.innerWidth;
	HEIGHT = window.innerHeight;

	PIXEL_RATIO = window.devicePixelRatio || 1;
	SCREEN_RATIO = WIDTH / HEIGHT;

	CAMERA.aspect = SCREEN_RATIO;
	CAMERA.updateProjectionMatrix();

	RENDERER.setSize( WIDTH, HEIGHT );
	RENDERER.setPixelRatio( PIXEL_RATIO );
}

//source: util.js
function debounce( func, wait, immediate ) {
	var _this = this,
		_arguments = arguments;

	var timeout;
	return function () {

		var context = _this,
			args = _arguments;
		var later = function later() {

			timeout = null;
			if ( !immediate ) func.apply( context, args );
		};
		var callNow = immediate && !timeout;
		clearTimeout( timeout );
		timeout = setTimeout( later, wait );
		if ( callNow ) func.apply( context, args );
	};
}

main();
run();
