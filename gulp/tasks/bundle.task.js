var gulp = require( 'gulp' );
var watchify = require( 'watchify' );
var browserify = require( 'browserify' );
var babelify = require( 'babelify' );
var gutil = require( 'gulp-util' );
var assign = require( 'lodash.assign' );
var source = require( 'vinyl-source-stream' );
var buffer = require( 'vinyl-buffer' );

var customOpts = {
	entries: [ './src/index.js' ],
	debug: true
};
var opts = assign( {}, watchify.args, customOpts );
var br = watchify( browserify( opts ) );
br.transform( babelify );
br.on( 'update', bundle );
br.on( 'log', gutil.log );

function bundle() {

	return br.bundle()
		.on( 'error', gutil.log.bind( gutil, 'Browserify Error' ) )
		.pipe( source( 'app.js' ) )
		.pipe( buffer() )
		.pipe( gulp.dest( './build/js' ) );

}

module.exports = bundle;
