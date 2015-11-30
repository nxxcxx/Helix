module.exports = [ '$stateProvider', '$urlRouterProvider', '$httpProvider',
function ( $stateProvider, $urlRouterProvider, $httpProvider ) {

	$urlRouterProvider.otherwise( '/' );

	$stateProvider
		.state( 'helix', {
			url: '/',
			templateUrl: './template/helix.html'
		} )
		.state( 'signup', {
			url: '/signup',
			templateUrl: './template/signup.html',
			controller: 'signupCtrl',
			controllerAs: 'signup'
		} )
		.state( 'signin', {
			url: '/signin',
			templateUrl: './template/signin.html',
			controller: 'signinCtrl',
			controllerAs: 'signin'
		} )
		.state( 'signout', {
			url: '/signout',
			controller: 'signoutCtrl'
		} )
		.state( 'movieDetail', {
			url: '/movie/:movieId',
			templateUrl: './template/movieDetail.html',
			controller: 'movieDetailCtrl',
			controllerAs: 'md',
			resolve: {
				movieItem: [ '$stateParams', 'TMDb', function ( $stateParams, TMDb ) {
					return TMDb.searchById( $stateParams.movieId );
				} ]
			}
		} )
		.state( 'collection', {
			url: '/collection',
			templateUrl: './template/collection.html',
			controller: 'movieCollectionCtrl',
			controllerAs: 'mc',
			resolve: {
				authorize: [ 'auth', function ( auth ) {
					return auth.authorize();
				} ],
				resolvedCollection: [ 'movieCollection', function ( movieCollection ) {
					return movieCollection.resolveCollection();
				} ]
			}
		} )
		.state( 'collectionSettings', {
			url: '/collection/settings/:collectionName',
			templateUrl: './template/collectionSettings.html',
			controller: 'collectionSettings',
			controllerAs: 'mcs'
		} )
	;

} ];
