var gulp = require( 'gulp' );
var browserSync = require( 'browser-sync' ).create();

module.exports = function () {

	browserSync.init( {

		files: [ './build/css/*.css' ],
		injectChanges: true,
		server: {
			baseDir: '.',
			index: 'index.html'
		},
		port: 3000,
		ui: false,
		open: false,
		reloadOnRestart: true

	} );

	gulp.watch( [
		
		'index.html',
		'./build/js/*',
		'./src/**/*.html',
		'./template/*'

	], browserSync.reload );

	gulp.watch( [ './sass/*.sass' ], [ 'sass' ] );

};
