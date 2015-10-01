var gulp = require( 'gulp' );

gulp.task( 'bundle', require( './tasks/bundle.task' ) );
gulp.task( 'sass', require( './tasks/sass.task' ) );
gulp.task( 'serve', [ 'bundle', 'sass' ], require( './tasks/serve.task') );
