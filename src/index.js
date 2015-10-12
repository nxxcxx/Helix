angular.module( 'app', [] )

.constant( 'TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
} )

.controller( 'mainCtrl', require( './main.ctrl.js' ) )
.directive( 'movieItem', require( './mvItem.dir.js' ) )
.factory( 'TMDb', require( './TMDb.fac.js' ) )
.factory( 'EVT', require( './events.fac.js' ) )
;

// webgl
require( './indexGL.js' );
